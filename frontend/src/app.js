import { supabase, signIn, signUp, onAuthChange } from './supabase-client.js'
import { initTurnManager, submitAction, resetCooldown } from './turn-manager.js'
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

// Guard: onAuthStateChange fires for both INITIAL_SESSION and SIGNED_IN on page load.
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
    .select('grid_cells(x, y, z, setting_id, settings(name))')
    .eq('entity_type', 'character')
    .eq('entity_id', characterId)
    .is('timestamp_end', null)
    .single()
  if (error || !data) return
  const gc = data.grid_cells
  if (!gc) return
  charPosXYZEl.textContent = `(${gc.x}, ${gc.y}, ${gc.z})`
  charSettingEl.textContent = gc.settings?.name ?? `S${gc.setting_id}`
}

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
  if (posErr || !pos) return { cellId: null, error: 'Could not find your current position.' }
  const { dx, dy, dz } = DIR_DELTA[direction]
  const tx = (pos.grid_cells?.x ?? 0) + dx
  const ty = (pos.grid_cells?.y ?? 0) + dy
  const tz = (pos.grid_cells?.z ?? 0) + dz
  const { data: cell, error: cellErr } = await supabase
    .from('grid_cells')
    .select('grid_cell_id')
    .eq('x', tx).eq('y', ty).eq('z', tz)
    .single()
  if (cellErr || !cell) return { cellId: null, error: `No cell exists to the ${direction}.` }
  return { cellId: cell.grid_cell_id, error: null }
}

// Pre-validate all 6 directions and grey out impossible ones
async function prevalidateDirections(characterId) {
  const checks = await Promise.all(
    Object.keys(DIR_DELTA).map(async (dir) => {
      const { cellId } = await getAdjacentCellId(dir, characterId)
      return { dir, exists: !!cellId }
    })
  )
  for (const { dir, exists } of checks) {
    const btn = document.querySelector(`.dir-btn[data-dir="${dir}"]`)
    if (!btn) continue
    if (exists) {
      btn.classList.remove('no-cell')
      btn.disabled = false
    } else {
      btn.classList.add('no-cell')
      btn.disabled = true
    }
  }
}

let travelCharacterId = null

async function openTravelModal(characterId) {
  travelCharacterId = characterId
  travelError.textContent = ''
  // Reset all dir buttons to loading state before pre-validation
  document.querySelectorAll('.dir-btn[data-dir]').forEach(b => {
    b.disabled = true
    b.classList.remove('no-cell')
  })
  travelModal.classList.add('open')
  await prevalidateDirections(characterId)
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
    const { cellId, error } = await getAdjacentCellId(direction, travelCharacterId)
    if (error || !cellId) {
      travelError.textContent = error || 'No cell in that direction.'
      // Re-run pre-validation to restore correct state
      await prevalidateDirections(travelCharacterId)
      return
    }
    closeTravelModal()
    setActionsDisabled(true)
    statusEl.textContent = `travelling ${direction}…`
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

  // Resolve controlled character before loading positions (needed for highlight)
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
    onCooldown: (sec) => { cooldownEl.textContent = sec > 0 ? `cooldown: ${sec}s` : '' },
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
      if (action === 'travel') {
        if (!characterId) { statusEl.textContent = 'error: no character assigned'; return }
        await openTravelModal(characterId)
        return
      }
      setActionsDisabled(true)
      statusEl.textContent = `submitting ${action}…`
      try {
        await submitAction(action)
        statusEl.textContent = `connected as ${user.email}`
      } catch (e) { statusEl.textContent = `error: ${e.message}` }
      finally { setActionsDisabled(false) }
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
}

function setActionsDisabled(disabled) {
  document.querySelectorAll('.action-btn').forEach(btn => btn.disabled = disabled)
}
