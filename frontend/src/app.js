import { supabase, signIn, signUp, onAuthChange } from './supabase-client.js'
import { initTurnManager, submitAction, resetCooldown, getCooldownRemaining } from './turn-manager.js'
import { initGridRenderer, loadEntityPositions, updateGrid, setLocalCharacterId } from './grid-renderer.js'
import { loadChronicle, appendChronicleEntry } from './chronicle-reader.js'

const authPanel       = document.getElementById('auth-panel')
const gameArea        = document.getElementById('game-area')
const sidebar         = document.getElementById('sidebar')
const statusEl        = document.getElementById('status')
const cooldownEl      = document.getElementById('cooldown-display')
const playerInfoEl    = document.getElementById('player-info')
const turnInfoEl      = document.getElementById('turn-info')
const branchInfoEl    = document.getElementById('branch-info')
const worldTimeEl     = document.getElementById('world-time')
const chronicleListEl = document.getElementById('chronicle-list')
const canvas          = document.getElementById('grid-canvas')
const travelModal     = document.getElementById('travel-modal')
const travelError     = document.getElementById('travel-error')
const charPosXYZEl    = document.getElementById('char-pos-xyz')
const charSettingEl   = document.getElementById('char-setting-name')
const charSettingDescEl = document.getElementById('char-setting-desc')

// Target modal elements
const targetModal         = document.getElementById('target-modal')
const targetModalTitle    = document.getElementById('target-modal-title')
const targetModalSubtitle = document.getElementById('target-modal-subtitle')
const targetError         = document.getElementById('target-error')
const targetList          = document.getElementById('target-list')
const targetEmpty         = document.getElementById('target-empty')
const targetAmountRow     = document.getElementById('target-amount-row')
const targetAmountInput   = document.getElementById('target-amount')

let gameInitialised = false

// ─── Auth UI ────────────────────────────────────────────────────────
document.getElementById('auth-sign-in').addEventListener('click', async () => {
  const email    = document.getElementById('auth-email').value
  const password = document.getElementById('auth-password').value
  try { await signIn(email, password) }
  catch (e) { document.getElementById('auth-error').textContent = e.message }
})

document.getElementById('auth-sign-up').addEventListener('click', async () => {
  const email    = document.getElementById('auth-email').value
  const password = document.getElementById('auth-password').value
  try {
    await signUp(email, password)
    document.getElementById('auth-error').textContent = 'Check your email to confirm account.'
  } catch (e) { document.getElementById('auth-error').textContent = e.message }
})

document.getElementById('auth-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('auth-sign-in').click()
})

onAuthChange(async (event, session) => {
  if (session?.user) showGame(session.user)
  else { gameInitialised = false; showAuth() }
})

// ─── World time ──────────────────────────────────────────────────
async function loadWorldTime() {
  const { data: tick }    = await supabase.from('world_tick_state').select('duration_unit').eq('id', 1).single()
  const { data: setting } = await supabase.from('settings').select('time_unit').eq('setting_id', 1).single()
  if (tick && setting) worldTimeEl.textContent = `tu: ${setting.time_unit} · du: ${tick.duration_unit}`
}

// ─── Character position UI ──────────────────────────────────────
async function loadCharPosition(characterId) {
  if (!characterId) return
  const { data, error } = await supabase
    .from('entity_positions')
    .select('grid_cells(x, y, z, setting_id)')
    .eq('entity_type', 'character')
    .eq('entity_id', characterId)
    .is('timestamp_end', null)
    .single()
  if (error || !data) return
  const gc = data.grid_cells
  if (!gc) return
  charPosXYZEl.textContent = `(${gc.x}, ${gc.y}, ${gc.z})`

  const { data: copy } = await supabase
    .from('entity_copies')
    .select('name, description')
    .eq('reality_id', 1)
    .eq('truth_entity_type', 'setting')
    .eq('truth_entity_id', gc.setting_id)
    .maybeSingle()

  charSettingEl.textContent = copy?.name ?? `S${gc.setting_id}`
  if (charSettingDescEl) charSettingDescEl.textContent = copy?.description ?? ''
}

// ─── Get current grid_cell_id for a character ───────────────────
async function getCharacterCellId(characterId) {
  const { data, error } = await supabase
    .from('entity_positions')
    .select('grid_cell_id')
    .eq('entity_type', 'character')
    .eq('entity_id', characterId)
    .is('timestamp_end', null)
    .single()
  if (error || !data) return null
  return data.grid_cell_id
}

// ─── Get other characters sharing the same grid cell ────────────
async function getColocatedCharacters(actorCharacterId) {
  const cellId = await getCharacterCellId(actorCharacterId)
  if (!cellId) return []

  const { data: positions, error } = await supabase
    .from('entity_positions')
    .select('entity_id')
    .eq('entity_type', 'character')
    .eq('grid_cell_id', cellId)
    .is('timestamp_end', null)
    .neq('entity_id', actorCharacterId)

  if (error || !positions?.length) return []

  const ids = positions.map(p => p.entity_id)

  const { data: chars, error: charErr } = await supabase
    .from('characters')
    .select('character_id, health, wealth, inspiration')
    .in('character_id', ids)

  if (charErr || !chars) return []
  return chars
}

// ─── Target modal ────────────────────────────────────────────────

const TARGET_ACTIONS = new Set(['introduce_conflict', 'resolve_conflict', 'exchange_material'])

const ACTION_LABELS = {
  introduce_conflict: { title: 'INTRODUCE CONFLICT', subtitle: 'choose a target character' },
  resolve_conflict:   { title: 'RESOLVE CONFLICT',   subtitle: 'choose a character to resolve with' },
  exchange_material:  { title: 'EXCHANGE MATERIAL',  subtitle: 'choose a character to trade with' },
}

let targetResolve = null

function openTargetModal(action, actorCharacterId, colocated) {
  return new Promise((resolve) => {
    targetResolve = resolve

    const labels = ACTION_LABELS[action] ?? { title: 'CHOOSE TARGET', subtitle: '' }
    targetModalTitle.textContent    = labels.title
    targetModalSubtitle.textContent = labels.subtitle
    targetError.textContent = ''

    if (action === 'exchange_material') {
      targetAmountRow.classList.add('visible')
      targetAmountInput.value = 1
    } else {
      targetAmountRow.classList.remove('visible')
    }

    targetList.innerHTML = ''
    if (!colocated.length) {
      targetEmpty.style.display = 'block'
    } else {
      targetEmpty.style.display = 'none'
      colocated.forEach(char => {
        const btn = document.createElement('button')
        btn.className = 'target-btn'
        btn.innerHTML = `
          <span>char #${char.character_id}</span>
          <span class="char-stats">hp:${char.health ?? '?'} · w:${char.wealth ?? '?'} · ins:${char.inspiration ?? '?'}</span>
        `
        btn.addEventListener('click', () => {
          const amount = action === 'exchange_material'
            ? Math.max(1, parseInt(targetAmountInput.value, 10) || 1)
            : undefined
          closeTargetModal(false)
          resolve({ target_character_id: char.character_id, wealth_amount: amount })
        })
        targetList.appendChild(btn)
      })
    }

    targetModal.classList.add('open')
  })
}

function closeTargetModal(cancel = true) {
  targetModal.classList.remove('open')
  targetError.textContent = ''
  if (cancel && targetResolve) {
    const r = targetResolve
    targetResolve = null
    r(null)
  } else {
    targetResolve = null
  }
}

document.getElementById('target-cancel').addEventListener('click', () => closeTargetModal(true))
targetModal.addEventListener('click', e => { if (e.target === targetModal) closeTargetModal(true) })

// ─── Direction picker ───────────────────────────────────────────────
const DIR_DELTA = {
  north: { dx:  0, dy: -1, dz:  0 },
  south: { dx:  0, dy:  1, dz:  0 },
  east:  { dx:  1, dy:  0, dz:  0 },
  west:  { dx: -1, dy:  0, dz:  0 },
  up:    { dx:  0, dy:  0, dz:  1 },
  down:  { dx:  0, dy:  0, dz: -1 },
}

async function getAdjacentCellId(direction, characterId) {
  const { data: pos, error: posErr } = await supabase
    .from('entity_positions')
    .select('grid_cell_id, grid_cells(x, y, z)')
    .eq('entity_type', 'character')
    .eq('entity_id', characterId)
    .is('timestamp_end', null)
    .single()
  if (posErr || !pos) return { cellId: null, spawned: false, copyName: null, copyDescription: null, error: 'Could not find your current position.' }

  const { dx, dy, dz } = DIR_DELTA[direction]
  const tx = (pos.grid_cells?.x ?? 0) + dx
  const ty = (pos.grid_cells?.y ?? 0) + dy
  const tz = (pos.grid_cells?.z ?? 0) + dz

  const { data, error } = await supabase.functions.invoke('discover-cell', {
    body: { x: tx, y: ty, z: tz, from_cell_id: pos.grid_cell_id }
  })

  if (error || !data?.grid_cell_id) {
    return { cellId: null, spawned: false, copyName: null, copyDescription: null, error: `Could not resolve cell to the ${direction}.` }
  }

  return {
    cellId: data.grid_cell_id,
    spawned: data.spawned ?? false,
    copyName: data.copy_name ?? null,
    copyDescription: data.copy_description ?? null,
    error: null,
  }
}

async function prevalidateDirections() {
  document.querySelectorAll('.dir-btn[data-dir]').forEach(btn => {
    btn.classList.remove('no-cell')
    btn.disabled = false
  })
}

let travelCharacterId = null

async function openTravelModal(characterId) {
  travelCharacterId = characterId
  travelError.textContent = ''
  travelModal.classList.add('open')
  await prevalidateDirections()
}

function closeTravelModal() {
  travelModal.classList.remove('open')
  travelError.textContent = ''
  travelCharacterId = null
}

document.getElementById('travel-cancel').addEventListener('click', closeTravelModal)
travelModal.addEventListener('click', e => { if (e.target === travelModal) closeTravelModal() })

document.querySelectorAll('.dir-btn[data-dir]').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (btn.disabled || btn.classList.contains('no-cell')) return
    const direction = btn.dataset.dir
    travelError.textContent = ''
    document.querySelectorAll('.dir-btn').forEach(b => b.disabled = true)

    const { cellId, spawned, copyName, copyDescription, error } = await getAdjacentCellId(direction, travelCharacterId)
    if (error || !cellId) {
      travelError.textContent = error || 'No cell in that direction.'
      await prevalidateDirections()
      return
    }

    const nameLabel = copyName ? ` — ${copyName}` : ''
    if (spawned) {
      statusEl.textContent = `discovering new cell to the ${direction}${nameLabel}…`
    } else {
      statusEl.textContent = `entering ${copyName ?? `cell to the ${direction}`}…`
    }

    closeTravelModal()
    setActionsDisabled(true)
    try {
      await submitAction('travel', { destination_grid_cell_id: cellId })
    } catch (e) {
      statusEl.textContent = `error: ${e.message}`
    } finally {
      setActionsDisabled(false)
    }
  })
})

// ─── showGame ─────────────────────────────────────────────────────
async function showGame(user) {
  authPanel.style.display  = 'none'
  gameArea.style.display   = 'block'
  sidebar.style.display    = 'flex'
  statusEl.textContent     = `connected as ${user.email}`
  playerInfoEl.textContent = `player: ${user.id.slice(0, 8)}…`

  if (gameInitialised) return
  gameInitialised = true

  initGridRenderer(canvas)

  let characterId = null
  const { data: playerRow } = await supabase
    .from('players')
    .select('controlled_character_id')
    .eq('player_id', user.id)
    .single()
  if (playerRow) {
    characterId = playerRow.controlled_character_id
    setLocalCharacterId(characterId)
  }

  await loadEntityPositions()
  await loadChronicle(chronicleListEl)
  await loadWorldTime()
  await loadCharPosition(characterId)

  initTurnManager({
    onCooldown:  (sec) => { cooldownEl.textContent = sec > 0 ? `cooldown: ${sec}s` : '' },
    onDisabled:  (disabled) => setActionsDisabled(disabled),
    onResult: (result) => {
      if (result.status === 'resolved') {
        turnInfoEl.textContent = `last turn: ${result.event?.turn_number ?? '?'}`
        appendChronicleEntry(chronicleListEl, { ...result.event, action: result.event?.event_type })
      } else if (result.status === 'queued') {
        statusEl.textContent = 'turn queued — waiting…'
      }
    },
  })

  document.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action

      // ── Travel: guard behind cooldown, then open direction picker ──
      if (action === 'travel') {
        if (!characterId) { statusEl.textContent = 'error: no character assigned'; return }
        if (getCooldownRemaining() > 0) return  // buttons greyed, but double-guard for safety
        await openTravelModal(characterId)
        return
      }

      if (action === 'exchange_information') {
        setActionsDisabled(true)
        statusEl.textContent = 'exchanging information…'
        try {
          await submitAction(action)
          statusEl.textContent = `connected as ${user.email}`
        } catch (e) { statusEl.textContent = `error: ${e.message}` }
        finally { setActionsDisabled(false) }
        return
      }

      if (TARGET_ACTIONS.has(action)) {
        if (!characterId) { statusEl.textContent = 'error: no character assigned'; return }

        setActionsDisabled(true)
        statusEl.textContent = 'looking for characters in your cell…'

        let colocated
        try {
          colocated = await getColocatedCharacters(characterId)
        } catch (e) {
          statusEl.textContent = `error: ${e.message}`
          setActionsDisabled(false)
          return
        }

        setActionsDisabled(false)
        statusEl.textContent = `connected as ${user.email}`

        const result = await openTargetModal(action, characterId, colocated)

        if (!result) return

        const { target_character_id, wealth_amount } = result
        const details = { target_character_id }
        if (wealth_amount !== undefined) details.wealth_amount = wealth_amount

        setActionsDisabled(true)
        statusEl.textContent = `submitting ${action} on char #${target_character_id}…`
        try {
          await submitAction(action, details)
          statusEl.textContent = `connected as ${user.email}`
        } catch (e) { statusEl.textContent = `error: ${e.message}` }
        finally { setActionsDisabled(false) }
        return
      }
    })
  })

  supabase.channel('turns')
    .on('broadcast', { event: 'turn_resolved' }, ({ payload }) => {
      loadEntityPositions()
      resetCooldown()
      loadChronicle(chronicleListEl)
      loadCharPosition(characterId)
      branchInfoEl.textContent = `branch: ${(payload.branch_id ?? 0) === 0 ? 'root' : payload.branch_id}`
    })
    .subscribe()

  supabase.channel('world-tick')
    .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'world_tick_state' },
        (payload) => {
          statusEl.textContent = `connected as ${user.email} · du: ${payload.new?.duration_unit}`
          loadWorldTime()
        })
    .subscribe()

  supabase.channel('entity-positions')
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'entity_positions' },
        () => {
          loadEntityPositions()
          loadCharPosition(characterId)
        })
    .subscribe()
}

function showAuth() {
  authPanel.style.display = 'flex'
  gameArea.style.display  = 'none'
  sidebar.style.display   = 'none'
  statusEl.textContent    = 'not connected'
  playerInfoEl.textContent = '—'
  charPosXYZEl.textContent = '—'
  charSettingEl.textContent = '—'
  if (charSettingDescEl) charSettingDescEl.textContent = ''
}

function setActionsDisabled(disabled) {
  document.querySelectorAll('.action-btn').forEach(btn => btn.disabled = disabled)
}
