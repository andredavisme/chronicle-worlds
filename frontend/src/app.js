import { supabase, signIn, signUp, signOut, onAuthChange } from './supabase-client.js'
import { initTurnManager, submitAction, resetCooldown } from './turn-manager.js'
import { initGridRenderer, loadEntityPositions, updateGrid } from './grid-renderer.js'
import { loadChronicle, appendChronicleEntry } from './chronicle-reader.js'

// DOM refs
const authPanel = document.getElementById('auth-panel')
const gameArea = document.getElementById('game-area')
const sidebar = document.getElementById('sidebar')
const statusEl = document.getElementById('status')
const cooldownEl = document.getElementById('cooldown-display')
const playerInfoEl = document.getElementById('player-info')
const turnInfoEl = document.getElementById('turn-info')
const branchInfoEl = document.getElementById('branch-info')
const chronicleListEl = document.getElementById('chronicle-list')
const canvas = document.getElementById('grid-canvas')

// Auth UI
document.getElementById('auth-sign-in').addEventListener('click', async () => {
  const email = document.getElementById('auth-email').value
  const password = document.getElementById('auth-password').value
  try {
    await signIn(email, password)
  } catch (e) {
    document.getElementById('auth-error').textContent = e.message
  }
})

document.getElementById('auth-sign-up').addEventListener('click', async () => {
  const email = document.getElementById('auth-email').value
  const password = document.getElementById('auth-password').value
  try {
    await signUp(email, password)
    document.getElementById('auth-error').textContent = 'Check your email to confirm account.'
  } catch (e) {
    document.getElementById('auth-error').textContent = e.message
  }
})

// Auth state machine
onAuthChange(async (event, session) => {
  if (session?.user) {
    showGame(session.user)
  } else {
    showAuth()
  }
})

async function showGame(user) {
  authPanel.style.display = 'none'
  gameArea.style.display = 'block'
  sidebar.style.display = 'flex'
  statusEl.textContent = `connected as ${user.email}`
  playerInfoEl.textContent = `player: ${user.id.slice(0, 8)}…`

  // Init subsystems
  initGridRenderer(canvas)
  await loadEntityPositions()
  await loadChronicle(chronicleListEl)

  initTurnManager({
    onCooldown: (sec) => {
      cooldownEl.textContent = sec > 0 ? `cooldown: ${sec}s` : ''
    },
    onResult: (result) => {
      if (result.status === 'resolved') {
        turnInfoEl.textContent = `last turn: ${result.event?.turn_number ?? '?'}`
        appendChronicleEntry(chronicleListEl, { ...result.event, action: result.event?.event_type })
      } else if (result.status === 'queued') {
        statusEl.textContent = 'turn queued — waiting…'
      }
    },
  })

  // Realtime: subscribe to turn_resolved broadcasts
  supabase.channel('turns')
    .on('broadcast', { event: 'turn_resolved' }, ({ payload }) => {
      updateGrid(payload)
      resetCooldown()
      loadChronicle(chronicleListEl)
      const branchId = payload.branch_id ?? 0
      branchInfoEl.textContent = `branch: ${branchId === 0 ? 'root' : branchId}`
    })
    .subscribe()

  // Action buttons
  document.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action
      setActionsDisabled(true)
      try {
        await submitAction(action)
      } catch (e) {
        statusEl.textContent = `error: ${e.message}`
      } finally {
        setActionsDisabled(false)
      }
    })
  })
}

function showAuth() {
  authPanel.style.display = 'flex'
  gameArea.style.display = 'none'
  sidebar.style.display = 'none'
  statusEl.textContent = 'not connected'
}

function setActionsDisabled(disabled) {
  document.querySelectorAll('.action-btn').forEach(btn => btn.disabled = disabled)
}
