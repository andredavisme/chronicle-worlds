import { supabase, signIn, signUp, onAuthChange } from './supabase-client.js'
import { initTurnManager, submitAction, resetCooldown, getCooldownRemaining } from './turn-manager.js'
import { initGridRenderer, loadEntityPositions, updateGrid, setLocalCharacterId } from './grid-renderer.js'
import { loadChronicle, appendChronicleEntry } from './chronicle-reader.js'

// ─── Constants ───────────────────────────────────────────────────────────────
const TARGET_ACTIONS = new Set([
  'exchange_information',
  'resolve_conflict',
  'introduce_conflict',
  'exchange_material',
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
  '  rest / wait          — rest: health +5, inspiration +2 [15u]',
  '  look                — show current position + z-layer',
  '  help / ?            — show this message',
]

// ─── DOM refs ────────────────────────────────────────────────────────────────
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

// ─── State ───────────────────────────────────────────────────────────────────
let characterId   = null
let characterPos  = null   // { x, y, z }
let pendingAction = null   // { action, targetId? }
let pendingAmount = null   // resolve fn for amount modal
let worldEntities = []
let currentMode   = 'buttons'

// ─── Helpers ─────────────────────────────────────────────────────────────────
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

// ─── Auth UI ─────────────────────────────────────────────────────────────────
function renderAuthUI() {
  document.body.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:12px;background:#0a0a0f;color:#cccccc;font-family:'Courier New',monospace;">
      <div style="font-size:1.1rem;color:#9999cc;letter-spacing:0.1em;margin-bottom:8px;">CHRONICLE WORLDS</div>
      <input id="auth-email" type="email" placeholder="email" style="background:#111120;border:1px solid #2a2a40;color:#aaaacc;font-family:inherit;font-size:0.85rem;padding:8px 12px;border-radius:3px;outline:none;width:260px;" />
      <input id="auth-pw" type="password" placeholder="password" style="background:#111120;border:1px solid #2a2a40;color:#aaaacc;font-family:inherit;font-size:0.85rem;padding:8px 12px;border-radius:3px;outline:none;width:260px;" />
      <div style="display:flex;gap:8px;">
        <button id="btn-signin" style="background:#1a1a3a;border:1px solid #4444aa;color:#9999dd;font-family:inherit;font-size:0.8rem;padding:7px 16px;border-radius:3px;cursor:pointer;">Sign In</button>
        <button id="btn-signup" style="background:none;border:1px solid #333355;color:#666688;font-family:inherit;font-size:0.8rem;padding:7px 16px;border-radius:3px;cursor:pointer;">Sign Up</button>
      </div>
      <div id="auth-msg" style="font-size:0.75rem;color:#cc7777;min-height:18px;"></div>
    </div>
  `
  const emailEl = document.getElementById('auth-email')
  const pwEl    = document.getElementById('auth-pw')
  const msgEl   = document.getElementById('auth-msg')
  document.getElementById('btn-signin').addEventListener('click', async () => {
    const { error } = await signIn(emailEl.value, pwEl.value)
    if (error) msgEl.textContent = error.message
  })
  document.getElementById('btn-signup').addEventListener('click', async () => {
    const { error } = await signUp(emailEl.value, pwEl.value)
    if (error) msgEl.textContent = error.message
    else msgEl.style.color = '#66cc88', msgEl.textContent = 'check your email to confirm'
  })
}

// ─── Character loader ────────────────────────────────────────────────────────
async function loadCharacter(userId) {
  const { data, error } = await supabase
    .from('entities')
    .select('id, name, archetype, attributes, x, y, z')
    .eq('owner_id', userId)
    .eq('entity_type', 'character')
    .maybeSingle()
  if (error || !data) return null
  return data
}

// ─── Position display ────────────────────────────────────────────────────────
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

  // z-layer badge
  const zVal = z ?? 0
  const { data: zRow } = await supabase
    .from('z_properties')
    .select('label, movement_type')
    .eq('z', zVal)
    .maybeSingle()

  if (zRow) {
    zLayerBadgeEl.textContent = `z${zVal}: ${zRow.label}`
    zLayerBadgeEl.style.display = 'inline-block'
  } else {
    zLayerBadgeEl.textContent = `z${zVal}`
    zLayerBadgeEl.style.display = 'inline-block'
  }
}

// ─── Cooldown bar ────────────────────────────────────────────────────────────
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

  // Disable/enable z buttons
  const upBtn   = document.getElementById('travel-up-btn')
  const downBtn = document.getElementById('travel-down-btn')
  upBtn.disabled   = false
  downBtn.disabled = z <= 0

  const costInfo = document.getElementById('travel-cost-info')
  costInfo.textContent = 'cost: calculating…'
  travelModal.classList.add('open')

  // Show cost info
  async function showCost(dx, dy, dz) {
    const tx = x + (dx || 0), ty = y + (dy || 0), tz = (z ?? 0) + (dz || 0)
    const { data } = await supabase
      .from('grid_cells')
      .select('terrain_cost, settings(name)')
      .eq('x', tx).eq('y', ty)
      .maybeSingle()
    const base = data?.terrain_cost ?? 1
    costInfo.textContent = `cost: ~${base}u${data?.settings?.name ? ' — ' + data.settings.name : ''}`
  }

  document.querySelectorAll('.compass-btn[data-dir]').forEach(btn => {
    btn.onmouseenter = () => {
      const dir = btn.dataset.dir
      const v = DIR_VECTORS[dir]
      showCost(v.dx, v.dy, v.dz)
    }
    btn.onclick = async () => {
      const dir = btn.dataset.dir
      travelModal.classList.remove('open')
      await executeAction('travel', characterId, null, { direction: dir })
    }
  })
}

document.getElementById('travel-cancel').addEventListener('click', () => {
  travelModal.classList.remove('open')
})

// ─── Target modal ─────────────────────────────────────────────────────────────
function openTargetModal(action) {
  return new Promise(resolve => {
    const { x, y, z } = characterPos
    targetSubtitle.textContent = `action: ${action.replace(/_/g, ' ')}`
    targetList.innerHTML = '<div style="color:#555577;font-size:0.75rem;">loading…</div>'
    targetModal.classList.add('open')

    supabase
      .from('entities')
      .select('id, name, archetype')
      .eq('x', x).eq('y', y).eq('z', z ?? 0)
      .eq('entity_type', 'character')
      .neq('id', characterId)
      .then(({ data }) => {
        targetList.innerHTML = ''
        if (!data || data.length === 0) {
          targetList.innerHTML = '<div style="color:#555577;font-size:0.75rem;">no characters here</div>'
          return
        }
        data.forEach(char => {
          const btn = document.createElement('button')
          btn.className = 'target-btn'
          btn.textContent = `${char.name} (${char.archetype})`
          btn.onclick = () => {
            targetModal.classList.remove('open')
            resolve(char.id)
          }
          targetList.appendChild(btn)
        })
      })

    document.getElementById('target-cancel').onclick = () => {
      targetModal.classList.remove('open')
      resolve(null)
    }
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
    document.getElementById('amount-cancel').onclick = () => {
      amountModal.classList.remove('open')
      resolve(null)
    }
  })
}

// ─── Core action executor ─────────────────────────────────────────────────────
async function executeAction(action, charId, user, extraParams = {}) {
  if (!charId) return { error: 'no character' }

  if (action === 'travel') {
    const { direction } = extraParams
    if (!direction) {
      openTravelModal()
      return { ok: false, pending: true }
    }
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
    } finally {
      setActionsDisabled(false)
    }
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
    } finally {
      setActionsDisabled(false)
    }
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
      const params = { target_entity_id: targetId }
      if (amount !== null) params.amount = amount
      const data = await submitAction(action, params)
      const delta = formatStatDeltas(data?.stat_deltas)
      statusEl.textContent = delta
        ? `${action.replace(/_/g, ' ')} — ${delta}`
        : `connected as ${user?.email ?? ''}`
      return { ok: true, statDeltas: data?.stat_deltas }
    } catch (e) {
      statusEl.textContent = `error: ${e.message}`
      return { error: e.message }
    } finally {
      setActionsDisabled(false)
    }
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

    if (getCooldownRemaining() > 0) {
      statusEl.textContent = 'still on cooldown…'
      return
    }

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

  if (input === 'help' || input === '?')
    return { type: 'local', local: 'help' }

  if (input === 'look')
    return { type: 'local', local: 'look' }

  if (input === 'rest' || input === 'wait' || input === 'idle')
    return { type: 'local', local: 'rest' }

  // travel
  const goMatch = input.match(/^(?:go|move|walk|travel)\s+(n|s|e|w|ne|nw|se|sw|north|south|east|west|northeast|northwest|southeast|southwest)$/)
  if (goMatch) {
    const abbr = { north:'n', south:'s', east:'e', west:'w', northeast:'ne', northwest:'nw', southeast:'se', southwest:'sw' }
    const dir = abbr[goMatch[1]] || goMatch[1]
    return { type: 'action', action: 'travel', params: { direction: dir } }
  }
  if (['n','s','e','w','ne','nw','se','sw'].includes(input))
    return { type: 'action', action: 'travel', params: { direction: input } }

  // z-axis
  if (input === 'fly' || input === 'go up' || input === 'ascend' || input === 'up')
    return { type: 'action', action: 'travel', params: { direction: 'up' } }
  if (input === 'dive' || input === 'go down' || input === 'descend' || input === 'down')
    return { type: 'action', action: 'travel', params: { direction: 'down' } }

  // social actions
  if (input === 'talk' || input === 'speak' || input === 'chat')
    return { type: 'action', action: 'exchange_information' }
  if (input === 'fight' || input === 'attack' || input === 'confront')
    return { type: 'action', action: 'introduce_conflict' }
  if (input === 'resolve' || input === 'mediate' || input === 'peace')
    return { type: 'action', action: 'resolve_conflict' }

  // trade
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
      cmdLogFn(`you are at ${pos}${badge ? ' [' + badge + ']' : ''}${setting ? ' — ' + setting : ''}`, 'out')
    } else if (parsed.local === 'rest') {
      if (getCooldownRemaining() > 0) { cmdLogFn('still on cooldown…', 'err'); return }
      cmdLogFn('resting…', 'info')
      const result = await executeAction('rest', characterId, user)
      if (result?.error) cmdLogFn('error: ' + result.error, 'err')
      else if (result?.ok) {
        const delta = formatStatDeltas(result.statDeltas)
        cmdLogFn(delta ? 'rested — ' + delta : 'rested.', 'info')
        if (result.statDeltas) {
          showStatDeltas(result.statDeltas)
          startCooldownBar(getCooldownRemaining())
        }
      }
    }
    return
  }

  if (parsed.type === 'action') {
    if (getCooldownRemaining() > 0) {
      cmdLogFn('still on cooldown…', 'err')
      return
    }
    cmdLogFn(`> ${raw}`, 'info')
    const extraParams = parsed.params || {}
    const result = await executeAction(parsed.action, characterId, user, extraParams)
    if (result?.error)  cmdLogFn(`error: ${result.error}`, 'err')
    else if (result?.cancelled) cmdLogFn('cancelled.', 'info')
    else if (result?.ok) {
      const delta = formatStatDeltas(result.statDeltas)
      cmdLogFn(delta ? delta : 'done.', 'out')
      if (result.statDeltas) {
        showStatDeltas(result.statDeltas)
        startCooldownBar(getCooldownRemaining())
      }
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

// ─── Realtime world log ────────────────────────────────────────────────────────
function initRealtimeLog() {
  supabase
    .channel('world-events')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events' }, payload => {
      const ev = payload.new
      appendToWorldLog(ev)
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

// ─── Main init ────────────────────────────────────────────────────────────────
async function init(user) {
  statusEl.textContent = `connected as ${user.email}`

  const char = await loadCharacter(user.id)
  if (!char) {
    statusEl.textContent = 'no character found — create one to play'
    return
  }

  characterId = char.id
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

  // Load recent world events
  const { data: recentEvents } = await supabase
    .from('events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20)
  if (recentEvents) recentEvents.reverse().forEach(appendToWorldLog)
}

// ─── Auth bootstrap ────────────────────────────────────────────────────────────
onAuthChange(user => {
  if (user) {
    init(user)
  } else {
    renderAuthUI()
  }
})
