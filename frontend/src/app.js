import { supabase, signIn, signUp, onAuthChange } from './supabase-client.js'
import { initTurnManager, submitAction, resetCooldown, getCooldownRemaining } from './turn-manager.js'
import { initGridRenderer, loadEntityPositions, updateGrid, setLocalCharacterId } from './grid-renderer.js'
import { loadChronicle, appendChronicleEntry } from './chronicle-reader.js'
import { renderLanding } from './landing.js'
import { renderCharacterCreator } from './character-creator.js'

// ─── Screen switching ─────────────────────────────────────────────────────────
function showLanding() {
  document.getElementById('landing-screen').classList.remove('hidden')
  document.getElementById('game-screen').classList.remove('active')
}

function showGame() {
  document.getElementById('landing-screen').classList.add('hidden')
  document.getElementById('game-screen').classList.add('active')
}

// ─── Constants ────────────────────────────────────────────────────────────────
const TARGET_ACTIONS = new Set([
  'exchange_information',
  'resolve_conflict',
  'introduce_conflict',
  'exchange_material',
  'reveal_stat',
])

const DIR_VECTORS = {
  n:  { dx:  0, dy: -1 },
  s:  { dx:  0, dy:  1 },
  e:  { dx:  1, dy:  0 },
  w:  { dx: -1, dy:  0 },
  ne: { dx:  1, dy: -1 },
  nw: { dx: -1, dy: -1 },
  se: { dx:  1, dy:  1 },
  sw: { dx: -1, dy:  1 },
  up:   { dz:  1 },
  down: { dz: -1 },
}

const HELP_TEXT = [
  '  go n/s/e/w          — travel horizontally',
  '  fly / go up         — travel to z+1 (requires flight)',
  '  dive / go down      — travel to z-1',
  '  talk                — exchange information',
  '  fight               — introduce conflict',
  '  resolve             — resolve conflict',
  '  trade [amount]      — exchange material',
  '  observe / read      — observe a character [8u]',
  '  rest / wait          — rest: health +5, inspiration +2 [15u]',
  '  look                — show current position + z-layer',
  '  help / ?            — show this message',
]

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const statusEl        = document.getElementById('status')
const charNameEl      = document.getElementById('char-name')
const charArchetypeEl = document.getElementById('char-archetype')
const charStatsEl     = document.getElementById('char-stats')
const charPosXYZEl    = document.getElementById('char-pos-xyz')
const charSettingEl   = document.getElementById('char-setting-desc')
const zLayerBadgeEl   = document.getElementById('z-layer-badge')
const actionPanel     = document.getElementById('action-panel')
const actionBtns      = () => actionPanel.querySelectorAll('.action-btn')
const cooldownWrap    = document.getElementById('cooldown-bar-wrap')
const cooldownFill    = document.getElementById('cooldown-bar-fill')
const statDeltasEl    = document.getElementById('stat-deltas')
const worldLogEl      = document.getElementById('world-log')
const travelModal     = document.getElementById('travel-modal')
const targetModal     = document.getElementById('target-modal')
const targetList      = document.getElementById('target-list')
const targetSubtitle  = document.getElementById('target-modal-subtitle')
const amountModal     = document.getElementById('amount-modal')
const amountInput     = document.getElementById('amount-input')
const modeToggle      = document.getElementById('mode-toggle')
const modeLabel       = document.getElementById('mode-label')
const actionPanelDiv  = document.getElementById('action-panel')
const cmdPanel        = document.getElementById('cmd-panel')
const cmdInput        = document.getElementById('cmd-input')
const cmdLog          = document.getElementById('cmd-log')
const snapshotPanel   = document.getElementById('snapshot-panel')
const snapshotRow     = document.getElementById('snapshot-row')

// ─── State ────────────────────────────────────────────────────────────────────
let characterId   = null
let characterPos  = null
let pendingAction = null
let pendingAmount = null
let worldEntities = []
let currentMode   = 'buttons'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setActionsDisabled(disabled) {
  actionBtns().forEach(b => b.disabled = disabled)
}

function formatStatDeltas(deltas) {
  if (!deltas || Object.keys(deltas).length === 0) return ''
  return Object.entries(deltas)
    .map(([k, v]) => {
      const sign  = v >= 0 ? '+' : ''
      const cls   = v >= 0 ? 'delta-pos' : 'delta-neg'
      return `<span class="${cls}">${sign}${v} ${k}</span>`
    })
    .join('  ')
}

function showStatDeltas(deltas) {
  if (!deltas) return
  statDeltasEl.innerHTML = formatStatDeltas(deltas)
  setTimeout(() => { statDeltasEl.innerHTML = '' }, 4000)
}

function showSnapshot(snapshot) {
  if (!snapshot) { snapshotPanel.style.display = 'none'; return }
  const STAT_KEYS = ['health', 'defense', 'attack', 'wealth', 'inspiration']
  snapshotRow.innerHTML = STAT_KEYS
    .map(k => `<span class="snap-stat">${k}: ${snapshot[k] ?? '?'}</span>`)
    .join(' ')
  snapshotPanel.style.display = 'block'
  setTimeout(() => { snapshotPanel.style.display = 'none' }, 12000)
}

// ─── Character loader — uses real schema ──────────────────────────────────────
// Flow: players → characters → entity_positions → grid_cells
//       + entity_copies (reality 1) for display name
async function loadCharacter(userId) {
  // 1. Get controlled_character_id from players row
  const { data: playerRow, error: pErr } = await supabase
    .from('players')
    .select('controlled_character_id')
    .eq('player_id', userId)
    .maybeSingle()
  if (pErr || !playerRow || !playerRow.controlled_character_id) return null

  const charId = playerRow.controlled_character_id

  // 2. Get character truth stats
  const { data: charRow, error: cErr } = await supabase
    .from('characters')
    .select('character_id, health, defense, attack, material, wealth, inspiration, size')
    .eq('character_id', charId)
    .maybeSingle()
  if (cErr || !charRow) return null

  // 3. Get current position via entity_positions → grid_cells
  const { data: posRow, error: posErr } = await supabase
    .from('entity_positions')
    .select('grid_cell_id, grid_cells(x, y, z)')
    .eq('entity_type', 'character')
    .eq('entity_id', charId)
    .is('timestamp_end', null)
    .order('timestamp_start', { ascending: false })
    .limit(1)
    .maybeSingle()
  const pos = posRow?.grid_cells ?? { x: 0, y: 0, z: 0 }

  // 4. Get display name + archetype from entity_copies (root reality)
  const { data: copyRow } = await supabase
    .from('entity_copies')
    .select('name, local_attributes')
    .eq('reality_id', 1)
    .eq('truth_entity_type', 'character')
    .eq('truth_entity_id', charId)
    .maybeSingle()

  return {
    id:        charId,
    name:      copyRow?.name ?? `Character #${charId}`,
    archetype: copyRow?.local_attributes?.archetype ?? 'wanderer',
    attributes: {
      health:      charRow.health,
      defense:     charRow.defense,
      attack:      charRow.attack,
      wealth:      charRow.wealth,
      inspiration: charRow.inspiration,
    },
    x: pos.x ?? 0,
    y: pos.y ?? 0,
    z: pos.z ?? 0,
  }
}

// ─── Position display ─────────────────────────────────────────────────────────
async function updatePositionDisplay(x, y, z) {
  charPosXYZEl.textContent = `(${x}, ${y}, z${z ?? 0})`

  const { data: cell } = await supabase
    .from('grid_cells')
    .select('setting_id, settings(name, description)')
    .eq('x', x).eq('y', y)
    .maybeSingle()

  if (cell?.settings) {
    charSettingEl.textContent = cell.settings.description || cell.settings.name || ''
  } else {
    charSettingEl.textContent = ''
  }

  const zVal = z ?? 0
  const { data: zRow } = await supabase
    .from('z_properties')
    .select('layer_name, requires_flight, requires_breath, conflict_modifier, health_decay, durability_decay_multiplier')
    .eq('z_layer', zVal)
    .maybeSingle()

  if (zRow) {
    zLayerBadgeEl.textContent = `z${zVal}: ${zRow.layer_name}`
    zLayerBadgeEl.style.display = 'inline-block'
    const lines = [`z-layer: ${zRow.layer_name}`]
    const mod = zRow.conflict_modifier
    if (mod != null) { const sign = mod >= 0 ? '+' : ''; lines.push(`Conflict modifier: ${sign}${mod}`) }
    const warnings = []
    if (zRow.health_decay > 0)                warnings.push(`health decay: -${zRow.health_decay}/tick`)
    if (zRow.durability_decay_multiplier > 1)  warnings.push(`durability decay: ×${zRow.durability_decay_multiplier}`)
    if (zRow.requires_flight)                  warnings.push('requires flight')
    if (zRow.requires_breath)                  warnings.push('requires breath')
    if (warnings.length > 0)                   lines.push(`⚠ ${warnings.join(' · ')}`)
    zLayerBadgeEl.title = lines.join('\n')
    if (zRow.health_decay > 0 || zRow.durability_decay_multiplier > 1) {
      zLayerBadgeEl.dataset.decay = 'true'
    } else {
      delete zLayerBadgeEl.dataset.decay
    }
  } else {
    zLayerBadgeEl.textContent = `z${zVal}`
    zLayerBadgeEl.style.display = 'inline-block'
    zLayerBadgeEl.title = ''
    delete zLayerBadgeEl.dataset.decay
  }
}

// ─── Cooldown bar ─────────────────────────────────────────────────────────────
let cooldownTimer = null
function startCooldownBar(durationMs) {
  cooldownWrap.style.display = 'block'
  const end = Date.now() + durationMs
  clearInterval(cooldownTimer)
  cooldownTimer = setInterval(() => {
    const remaining = end - Date.now()
    if (remaining <= 0) {
      cooldownFill.style.width = '0%'
      cooldownWrap.style.display = 'none'
      clearInterval(cooldownTimer)
      return
    }
    cooldownFill.style.width = `${(remaining / durationMs) * 100}%`
  }, 200)
}

// ─── Travel modal ─────────────────────────────────────────────────────────────
function openTravelModal() {
  const { x, y, z } = characterPos
  const upBtn   = document.getElementById('travel-up-btn')
  const downBtn = document.getElementById('travel-down-btn')
  upBtn.disabled   = false
  downBtn.disabled = z <= 0
  const costInfo = document.getElementById('travel-cost-info')
  costInfo.textContent = 'cost: calculating…'
  travelModal.classList.add('open')

  async function showCost(dx, dy, dz) {
    const tx = x + (dx || 0), ty = y + (dy || 0), tz = (z ?? 0) + (dz || 0)
    const { data } = await supabase
      .from('grid_cells').select('terrain_cost, settings(name)').eq('x', tx).eq('y', ty).maybeSingle()
    const base = data?.terrain_cost ?? 1
    costInfo.textContent = `cost: ~${base}u${data?.settings?.name ? ' — ' + data.settings.name : ''}`
  }

  document.querySelectorAll('.compass-btn[data-dir]').forEach(btn => {
    btn.onmouseenter = () => { const v = DIR_VECTORS[btn.dataset.dir]; showCost(v.dx, v.dy, v.dz) }
    btn.onclick = async () => {
      travelModal.classList.remove('open')
      await executeAction('travel', characterId, null, { direction: btn.dataset.dir })
    }
  })
}

document.getElementById('travel-cancel').addEventListener('click', () => travelModal.classList.remove('open'))

// ─── Target modal ─────────────────────────────────────────────────────────────
function openTargetModal(action) {
  return new Promise(resolve => {
    const { x, y, z } = characterPos
    targetSubtitle.textContent = `action: ${action.replace(/_/g, ' ')}`
    targetList.innerHTML = '<div style="color:#555577;font-size:0.75rem;">loading…</div>'
    targetModal.classList.add('open')

    // Find other characters at same grid cell via entity_positions → grid_cells
    supabase
      .from('entity_positions')
      .select('entity_id, grid_cells!inner(x, y, z)')
      .eq('entity_type', 'character')
      .is('timestamp_end', null)
      .eq('grid_cells.x', x)
      .eq('grid_cells.y', y)
      .eq('grid_cells.z', z ?? 0)
      .neq('entity_id', characterId)
      .then(async ({ data: positions }) => {
        targetList.innerHTML = ''
        if (!positions || positions.length === 0) {
          targetList.innerHTML = '<div style="color:#555577;font-size:0.75rem;">no characters here</div>'
          return
        }
        // Fetch display names from entity_copies
        const ids = positions.map(p => p.entity_id)
        const { data: copies } = await supabase
          .from('entity_copies')
          .select('truth_entity_id, name, local_attributes')
          .eq('reality_id', 1)
          .eq('truth_entity_type', 'character')
          .in('truth_entity_id', ids)

        positions.forEach(pos => {
          const copy = copies?.find(c => c.truth_entity_id === pos.entity_id)
          const btn = document.createElement('button')
          btn.className = 'target-btn'
          btn.textContent = copy
            ? `${copy.name} (${copy.local_attributes?.archetype ?? '?'})`
            : `Character #${pos.entity_id}`
          btn.onclick = () => { targetModal.classList.remove('open'); resolve(pos.entity_id) }
          targetList.appendChild(btn)
        })
      })
    document.getElementById('target-cancel').onclick = () => { targetModal.classList.remove('open'); resolve(null) }
  })
}

// ─── Amount modal ─────────────────────────────────────────────────────────────
function openAmountModal() {
  return new Promise(resolve => {
    amountInput.value = ''
    amountModal.classList.add('open')
    amountInput.focus()
    document.getElementById('amount-confirm').onclick = () => {
      const val = parseInt(amountInput.value, 10)
      amountModal.classList.remove('open')
      resolve(isNaN(val) || val < 1 ? null : val)
    }
    document.getElementById('amount-cancel').onclick = () => { amountModal.classList.remove('open'); resolve(null) }
  })
}

// ─── Core action executor ─────────────────────────────────────────────────────
async function executeAction(action, charId, user, extraParams = {}) {
  if (!charId) return { error: 'no character' }

  if (action === 'travel') {
    const { direction } = extraParams
    if (!direction) { openTravelModal(); return { ok: false, pending: true } }
    setActionsDisabled(true)
    statusEl.textContent = 'travelling…'
    try {
      const data = await submitAction('travel', { direction })
      const delta = formatStatDeltas(data?.stat_deltas)
      statusEl.textContent = delta ? `travelled — ${delta}` : `connected as ${user?.email ?? ''}`
      if (data?.new_position) {
        characterPos = data.new_position
        await updatePositionDisplay(characterPos.x, characterPos.y, characterPos.z)
        await updateGrid()
      }
      return { ok: true, statDeltas: data?.stat_deltas }
    } catch (e) {
      statusEl.textContent = `error: ${e.message}`
      return { error: e.message }
    } finally { setActionsDisabled(false) }
  }

  if (action === 'rest') {
    setActionsDisabled(true)
    statusEl.textContent = 'resting…'
    try {
      const data = await submitAction('rest')
      const delta = formatStatDeltas(data?.stat_deltas)
      statusEl.textContent = delta ? `rested — ${delta}` : `connected as ${user?.email ?? ''}`
      return { ok: true, statDeltas: data?.stat_deltas }
    } catch (e) {
      statusEl.textContent = `error: ${e.message}`
      return { error: e.message }
    } finally { setActionsDisabled(false) }
  }

  if (TARGET_ACTIONS.has(action)) {
    let targetId = extraParams.targetId ?? null
    if (!targetId) {
      targetId = await openTargetModal(action)
      if (!targetId) return { ok: false, cancelled: true }
    }
    let amount = null
    if (action === 'exchange_material') {
      amount = await openAmountModal()
      if (!amount) return { ok: false, cancelled: true }
    }
    setActionsDisabled(true)
    statusEl.textContent = `${action.replace(/_/g, ' ')}…`
    try {
      const params = { target_character_id: targetId }
      if (amount !== null) params.wealth_amount = amount
      const data = await submitAction(action, params)
      const delta = formatStatDeltas(data?.stat_deltas)
      statusEl.textContent = delta
        ? `${action.replace(/_/g, ' ')} — ${delta}`
        : `connected as ${user?.email ?? ''}`
      if (action === 'reveal_stat' && data?.snapshot) showSnapshot(data.snapshot)
      return { ok: true, statDeltas: data?.stat_deltas, snapshot: data?.snapshot ?? null }
    } catch (e) {
      statusEl.textContent = `error: ${e.message}`
      return { error: e.message }
    } finally { setActionsDisabled(false) }
  }

  return { error: `unknown action: ${action}` }
}

// ─── Action button wiring ─────────────────────────────────────────────────────
function wireActionButtons(user) {
  actionPanel.addEventListener('click', async e => {
    const btn = e.target.closest('.action-btn')
    if (!btn || btn.disabled) return
    const action = btn.dataset.action
    if (!action) return
    if (getCooldownRemaining() > 0) { statusEl.textContent = 'still on cooldown…'; return }
    const result = await executeAction(action, characterId, user)
    if (result?.ok && result.statDeltas) {
      showStatDeltas(result.statDeltas)
      startCooldownBar(getCooldownRemaining())
    }
  })
}

// ─── Text command mode ────────────────────────────────────────────────────────
function cmdLogLine(text, type = 'info') {
  const line = document.createElement('div')
  line.className = `cmd-line ${type}`
  line.textContent = text
  cmdLog.appendChild(line)
  cmdLog.scrollTop = cmdLog.scrollHeight
}
const cmdLogFn = cmdLogLine

function parseCommand(raw) {
  const input = raw.trim().toLowerCase()
  if (!input) return null
  if (input === 'help' || input === '?')      return { type: 'local', local: 'help' }
  if (input === 'look')                        return { type: 'local', local: 'look' }
  if (input === 'rest' || input === 'wait' || input === 'idle') return { type: 'local', local: 'rest' }

  const goMatch = input.match(/^(?:go|move|walk|travel)\s+(n|s|e|w|ne|nw|se|sw|north|south|east|west|northeast|northwest|southeast|southwest)$/)
  if (goMatch) {
    const abbr = { north:'n', south:'s', east:'e', west:'w', northeast:'ne', northwest:'nw', southeast:'se', southwest:'sw' }
    return { type: 'action', action: 'travel', params: { direction: abbr[goMatch[1]] || goMatch[1] } }
  }
  if (['n','s','e','w','ne','nw','se','sw'].includes(input))
    return { type: 'action', action: 'travel', params: { direction: input } }

  if (input === 'fly' || input === 'go up' || input === 'ascend' || input === 'up')
    return { type: 'action', action: 'travel', params: { direction: 'up' } }
  if (input === 'dive' || input === 'go down' || input === 'descend' || input === 'down')
    return { type: 'action', action: 'travel', params: { direction: 'down' } }

  if (input === 'talk' || input === 'speak' || input === 'chat')
    return { type: 'action', action: 'exchange_information' }
  if (input === 'fight' || input === 'attack' || input === 'confront')
    return { type: 'action', action: 'introduce_conflict' }
  if (input === 'resolve' || input === 'mediate' || input === 'peace')
    return { type: 'action', action: 'resolve_conflict' }
  if (input === 'observe' || input === 'read' || input === 'sense' || input === 'study')
    return { type: 'action', action: 'reveal_stat' }

  const tradeMatch = input.match(/^trade(?:\s+(\d+))?$/)
  if (tradeMatch)
    return { type: 'action', action: 'exchange_material', params: { amount: tradeMatch[1] ? parseInt(tradeMatch[1], 10) : null } }

  return { type: 'unknown', raw: input }
}

async function handleCommand(raw, user) {
  const parsed = parseCommand(raw)
  if (!parsed) return
  if (parsed.type === 'local') {
    if (parsed.local === 'help') {
      HELP_TEXT.forEach(l => cmdLogFn(l, 'info'))
    } else if (parsed.local === 'look') {
      const pos     = charPosXYZEl.textContent
      const setting = charSettingEl.textContent
      const badge   = zLayerBadgeEl.textContent
      const tip     = zLayerBadgeEl.title
      cmdLogFn(`you are at ${pos}${badge ? ' [' + badge + ']' : ''}${setting ? ' — ' + setting : ''}`, 'out')
      if (tip) tip.split('\n').slice(1).forEach(l => cmdLogFn(`  ${l}`, 'info'))
    } else if (parsed.local === 'rest') {
      if (getCooldownRemaining() > 0) { cmdLogFn('still on cooldown…', 'err'); return }
      cmdLogFn('resting…', 'info')
      const result = await executeAction('rest', characterId, user)
      if (result?.error) cmdLogFn('error: ' + result.error, 'err')
      else if (result?.ok) {
        const delta = formatStatDeltas(result.statDeltas)
        cmdLogFn(delta ? 'rested — ' + delta : 'rested.', 'info')
        if (result.statDeltas) { showStatDeltas(result.statDeltas); startCooldownBar(getCooldownRemaining()) }
      }
    }
    return
  }
  if (parsed.type === 'action') {
    if (getCooldownRemaining() > 0) { cmdLogFn('still on cooldown…', 'err'); return }
    cmdLogFn(`> ${raw}`, 'info')
    const result = await executeAction(parsed.action, characterId, user, parsed.params || {})
    if (result?.error)     cmdLogFn(`error: ${result.error}`, 'err')
    else if (result?.cancelled) cmdLogFn('cancelled.', 'info')
    else if (result?.ok) {
      const delta = formatStatDeltas(result.statDeltas)
      cmdLogFn(delta ? delta : 'done.', 'out')
      if (result.snapshot) {
        const snap = result.snapshot
        cmdLogFn(`observed — health:${snap.health} defense:${snap.defense} attack:${snap.attack} wealth:${snap.wealth} inspiration:${snap.inspiration}`, 'out')
        showSnapshot(snap)
      }
      if (result.statDeltas) { showStatDeltas(result.statDeltas); startCooldownBar(getCooldownRemaining()) }
    }
    return
  }
  cmdLogFn(`unknown command: ${parsed.raw} (type 'help' for commands)`, 'err')
}

// ─── Mode toggle ──────────────────────────────────────────────────────────────
function initModeToggle(user) {
  modeToggle.addEventListener('click', () => {
    if (currentMode === 'buttons') {
      currentMode = 'text'
      actionPanelDiv.style.display = 'none'
      cmdPanel.style.display = 'block'
      modeToggle.textContent = 'BUTTONS'
      modeLabel.textContent = 'COMMAND'
      cmdInput.focus()
    } else {
      currentMode = 'buttons'
      actionPanelDiv.style.display = 'flex'
      cmdPanel.style.display = 'none'
      modeToggle.textContent = 'TEXT'
      modeLabel.textContent = 'ACTIONS'
    }
  })
  cmdInput.addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return
    const raw = cmdInput.value.trim()
    cmdInput.value = ''
    if (!raw) return
    await handleCommand(raw, user)
  })
}

// ─── Realtime world log ───────────────────────────────────────────────────────
function initRealtimeLog() {
  supabase.channel('world-events')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events' }, payload => {
      appendToWorldLog(payload.new)
    })
    .subscribe()
}

function appendToWorldLog(ev) {
  const entry = document.createElement('div')
  entry.className = 'log-entry'
  entry.innerHTML = `
    <span class="actor">${ev.actor_entity_id?.slice(0, 6) ?? '?'}</span>
    <span class="action-type"> ${ev.event_type?.replace(/_/g, ' ')}</span>
    <span class="tick">#${ev.world_tick ?? '?'}</span>
  `
  worldLogEl.prepend(entry)
  if (worldLogEl.children.length > 50) worldLogEl.lastChild?.remove()
}

// ─── Main game init ───────────────────────────────────────────────────────────
async function initGame(user, char) {
  showGame()
  statusEl.textContent = `connected as ${user.email}`

  characterId  = char.id
  characterPos = { x: char.x, y: char.y, z: char.z ?? 0 }

  charNameEl.textContent      = char.name
  charArchetypeEl.textContent = char.archetype
  charStatsEl.textContent     = Object.entries(char.attributes || {})
    .map(([k, v]) => `${k}: ${v}`).join(' · ')

  await updatePositionDisplay(characterPos.x, characterPos.y, characterPos.z)

  setLocalCharacterId(characterId)
  await initGridRenderer(document.getElementById('grid-canvas'))
  await updateGrid()

  initTurnManager(characterId, {
    onCooldownStart: (ms) => startCooldownBar(ms),
    onCooldownEnd:   ()   => setActionsDisabled(false),
  })

  wireActionButtons(user)
  initModeToggle(user)
  initRealtimeLog()

  const { data: recentEvents } = await supabase
    .from('events').select('*').order('created_at', { ascending: false }).limit(20)
  if (recentEvents) recentEvents.reverse().forEach(appendToWorldLog)
}

// ─── Player count for landing page ───────────────────────────────────────────
// Correct query: count players who have a character assigned
// (used by landing.js fetchPlayerCount — re-exported here for completeness)
export async function fetchPlayerCount() {
  const { count } = await supabase
    .from('players')
    .select('controlled_character_id', { count: 'exact', head: true })
    .not('controlled_character_id', 'is', null)
  return count ?? 0
}

// ─── Auth bootstrap ───────────────────────────────────────────────────────────
onAuthChange(async user => {
  if (!user) {
    renderLanding()
    return
  }

  const char = await loadCharacter(user.id)

  if (char) {
    await initGame(user, char)
  } else {
    renderCharacterCreator(user.id, async (newChar) => {
      await initGame(user, newChar)
    })
  }
})
