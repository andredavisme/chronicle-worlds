import { supabase, signIn, signUp, onAuthChange } from './supabase-client.js'
import { initTurnManager, submitAction, resetCooldown } from './turn-manager.js'
import { initGridRenderer, loadEntityPositions, updateGrid } from './grid-renderer.js'
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

document.getElementById('auth-sign-in').addEventListener('click', async () => {
  const email = document.getElementById('auth-email').value
  const password = document.getElementById('auth-password').value
  try { await signIn(email, password) }
  catch (e) { document.getElementById('auth-error').textContent = e.message }
})

document.getElementById('auth-sign-up').addEventListener('click', async () => {
  const email = document.getElementById('auth-email').value
  const password = document.getElementById('auth-password').value
  try {
    await signUp(email, password)
    document.getElementById('auth-error').textContent = 'Check your email to confirm account.'
  } catch (e) { document.getElementById('auth-error').textContent = e.message }
})

onAuthChange(async (event, session) => {
  if (session?.user) showGame(session.user)
  else showAuth()
})

async function loadWorldTime() {
  const { data } = await supabase
    .from('world_tick_state')
    .select('duration_unit')
    .eq('id', 1)
    .single()
  const { data: setting } = await supabase
    .from('settings')
    .select('time_unit')
    .eq('setting_id', 1)
    .single()
  if (data && setting) {
    worldTimeEl.textContent = `tu: ${setting.time_unit} · du: ${data.duration_unit}`
  }
}

async function showGame(user) {
  authPanel.style.display  = 'none'
  gameArea.style.display   = 'block'
  sidebar.style.display    = 'flex'
  statusEl.textContent     = `connected as ${user.email}`
  playerInfoEl.textContent = `player: ${user.id.slice(0, 8)}…`

  initGridRenderer(canvas)
  await loadEntityPositions()
  await loadChronicle(chronicleListEl)
  await loadWorldTime()

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

  // Player turn broadcasts
  supabase.channel('turns')
    .on('broadcast', { event: 'turn_resolved' }, ({ payload }) => {
      updateGrid(payload)
      resetCooldown()
      loadChronicle(chronicleListEl)
      const branchId = payload.branch_id ?? 0
      branchInfoEl.textContent = `branch: ${branchId === 0 ? 'root' : branchId}`
    })
    .subscribe()

  // World tick — update time display + reload grid
  supabase.channel('world-tick')
    .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'world_tick_state' },
        (payload) => {
          const du = payload.new?.duration_unit
          statusEl.textContent = `connected as ${user.email} · du: ${du}`
          loadWorldTime()
          updateGrid(payload)
        })
    .subscribe()

  // Live entity spawn/move redraws
  supabase.channel('entity-positions')
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'entity_positions' },
        () => { loadEntityPositions() })
    .subscribe()
}

function showAuth() {
  authPanel.style.display = 'flex'
  gameArea.style.display  = 'none'
  sidebar.style.display   = 'none'
  statusEl.textContent    = 'not connected'
}

function setActionsDisabled(disabled) {
  document.querySelectorAll('.action-btn').forEach(btn => btn.disabled = disabled)
}

document.querySelectorAll('.action-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const action = btn.dataset.action
    setActionsDisabled(true)
    try { await submitAction(action) }
    catch (e) { statusEl.textContent = `error: ${e.message}` }
    finally { setActionsDisabled(false) }
  })
})
