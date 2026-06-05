// landing.js — Entry screen: philosophy, mechanics, auth, player count
import { supabase, signIn, signUp } from './supabase-client.js'

// ─── Live player count ────────────────────────────────────────────────────────
export async function fetchPlayerCount() {
  const { count } = await supabase
    .from('entities')
    .select('id', { count: 'exact', head: true })
    .eq('entity_type', 'character')
  return count ?? 0
}

// ─── Auth panel (sign in / sign up tabs) ─────────────────────────────────────
function buildAuthPanel() {
  return `
    <div id="auth-panel">
      <div id="auth-tabs">
        <button class="auth-tab active" data-tab="signin">Sign In</button>
        <button class="auth-tab" data-tab="signup">Sign Up</button>
      </div>
      <div id="auth-fields">
        <input id="lp-email" type="email" placeholder="email" autocomplete="email" />
        <input id="lp-pw" type="password" placeholder="password" autocomplete="current-password" />
        <button id="lp-submit">ENTER THE WORLD</button>
        <div id="lp-auth-msg"></div>
      </div>
    </div>
  `
}

// ─── Mechanic cards ───────────────────────────────────────────────────────────
const MECHANICS = [
  {
    icon: '◎',
    title: 'Explore',
    body: 'Move across a living grid of settings — forests, ruins, depths, sky. Each cell you enter is discovered, named, and remembered by the world.'
  },
  {
    icon: '◈',
    title: 'Connect',
    body: 'Talk, trade, observe, fight, or resolve. Every interaction between characters writes a line into the shared chronicle. Nothing is private; everything persists.'
  },
  {
    icon: '◉',
    title: 'Chronicle',
    body: 'Time advances with every action. The world grows whether you are present or not. Branch the timeline. Fork your story. The truth remains underneath it all.'
  },
]

function buildMechanicCards() {
  return MECHANICS.map(m => `
    <div class="mechanic-card">
      <div class="mc-icon">${m.icon}</div>
      <div class="mc-title">${m.title}</div>
      <div class="mc-body">${m.body}</div>
    </div>
  `).join('')
}

// ─── Main render ──────────────────────────────────────────────────────────────
export function renderLanding(onAuthSuccess) {
  const root = document.getElementById('landing-screen')
  root.innerHTML = `
    <div id="lp-bg">
      <div id="lp-grid-lines" aria-hidden="true"></div>
    </div>

    <div id="lp-content">

      <header id="lp-header">
        <div id="lp-logo">
          <svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="14" cy="14" r="12" stroke="#5555aa" stroke-width="1.5"/>
            <ellipse cx="14" cy="14" rx="5" ry="12" stroke="#5555aa" stroke-width="1"/>
            <line x1="2" y1="14" x2="26" y2="14" stroke="#5555aa" stroke-width="1"/>
            <line x1="4" y1="8" x2="24" y2="8" stroke="#333366" stroke-width="0.75"/>
            <line x1="4" y1="20" x2="24" y2="20" stroke="#333366" stroke-width="0.75"/>
            <circle cx="14" cy="14" r="2" fill="#7777cc"/>
          </svg>
          <span>CHRONICLE WORLDS</span>
        </div>
        <div id="lp-player-count" title="characters created across all realities">
          <span id="lp-count-num">…</span>
          <span id="lp-count-label">explorers</span>
        </div>
      </header>

      <main id="lp-main">
        <section id="lp-philosophy">
          <h1 id="lp-headline">Every world calls the same thing<br>by a different name.</h1>
          <p id="lp-sub">
            A forest and a battlefield and a marketplace can occupy the same coordinates.
            They are not contradictions — they are translations.
            Beneath every reality that has ever been given a name,
            there is a truth that needs none.
          </p>
          <p id="lp-sub2">
            Chronicle Worlds is a shared, living simulation of that idea.
            You will move through settings, meet other characters, leave marks on the timeline.
            What you call your experience is yours to decide.
            The record will simply say: <em>this happened here, at this time.</em>
          </p>
          <a href="#lp-mechanics" id="lp-learn-more">learn how it works ↓</a>
        </section>

        <section id="lp-enter">
          <div id="lp-enter-inner">
            <div id="lp-enter-heading">Begin your chronicle</div>
            ${buildAuthPanel()}
          </div>
        </section>
      </main>

      <section id="lp-mechanics">
        <div id="lp-mechanics-label">How the world works</div>
        <div id="lp-mechanic-cards">
          ${buildMechanicCards()}
        </div>

        <div id="lp-action-table-wrap">
          <div class="lp-table-label">Actions &amp; time cost</div>
          <table id="lp-action-table">
            <thead><tr><th>Action</th><th>Duration</th><th>Effect</th></tr></thead>
            <tbody>
              <tr><td>Exchange Information</td><td>10u</td><td>inspiration +3</td></tr>
              <tr><td>Resolve Conflict</td><td>7u</td><td>health +3</td></tr>
              <tr><td>Introduce Conflict</td><td>5u</td><td>health −3 to target</td></tr>
              <tr><td>Exchange Material</td><td>3u</td><td>wealth transfer</td></tr>
              <tr><td>Observe</td><td>8u</td><td>read target's stats</td></tr>
              <tr><td>Travel</td><td>calc</td><td>move on the grid</td></tr>
              <tr><td>Rest</td><td>15u</td><td>health +5, inspiration +2</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <footer id="lp-footer">
        <span>Chronicle Worlds — a shared truth in many realities</span>
      </footer>

    </div>
  `

  // Load player count
  fetchPlayerCount().then(n => {
    const el = document.getElementById('lp-count-num')
    if (el) el.textContent = n.toLocaleString()
  })

  // Auth tab switching
  let currentTab = 'signin'
  root.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentTab = tab.dataset.tab
      root.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === currentTab))
      const pw = document.getElementById('lp-pw')
      pw.autocomplete = currentTab === 'signup' ? 'new-password' : 'current-password'
      document.getElementById('lp-submit').textContent =
        currentTab === 'signup' ? 'CREATE ACCOUNT' : 'ENTER THE WORLD'
      document.getElementById('lp-auth-msg').textContent = ''
    })
  })

  // Auth submit
  document.getElementById('lp-submit').addEventListener('click', async () => {
    const email = document.getElementById('lp-email').value.trim()
    const pw    = document.getElementById('lp-pw').value
    const msg   = document.getElementById('lp-auth-msg')
    msg.textContent = ''
    msg.className = ''

    if (!email || !pw) {
      msg.textContent = 'please enter your email and password'
      return
    }

    const btn = document.getElementById('lp-submit')
    btn.disabled = true
    btn.textContent = '…'

    if (currentTab === 'signup') {
      const { error } = await signUp(email, pw)
      if (error) {
        msg.textContent = error.message
        btn.disabled = false
        btn.textContent = 'CREATE ACCOUNT'
      } else {
        msg.className = 'success'
        msg.textContent = 'check your email to confirm, then sign in'
        btn.disabled = false
        btn.textContent = 'CREATE ACCOUNT'
      }
    } else {
      const { error } = await signIn(email, pw)
      if (error) {
        msg.textContent = error.message
        btn.disabled = false
        btn.textContent = 'ENTER THE WORLD'
      }
      // on success, onAuthChange in app.js fires → onAuthSuccess() is called externally
    }
  })

  // Enter on keydown in password field
  document.getElementById('lp-pw').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('lp-submit').click()
  })
}
