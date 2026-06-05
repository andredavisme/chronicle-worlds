// character-creator.js — Character creation flow for new players
import { supabase } from './supabase-client.js'

const ARCHETYPES = [
  {
    id: 'seeker',
    label: 'Seeker',
    glyph: '◎',
    tagline: 'Drawn to the unknown',
    description: 'You travel further and tire less. Other characters sense something restless in you — a question not yet answered.',
    stats: { health: 80, inspiration: 40, attack: 20, defense: 20, wealth: 20 }
  },
  {
    id: 'builder',
    label: 'Builder',
    glyph: '◧',
    tagline: 'Shaping what endures',
    description: 'Your wealth accumulates faster; exchanges favour you. What you make outlasts you.',
    stats: { health: 60, inspiration: 20, attack: 10, defense: 30, wealth: 60 }
  },
  {
    id: 'wanderer',
    label: 'Wanderer',
    glyph: '◈',
    tagline: 'Belonging everywhere, settled nowhere',
    description: 'Balanced across all dimensions. You arrive without expectation and leave without loss.',
    stats: { health: 60, inspiration: 30, attack: 25, defense: 25, wealth: 30 }
  },
  {
    id: 'keeper',
    label: 'Keeper',
    glyph: '◉',
    tagline: 'Holding the thread of what was',
    description: 'High defense, strong in resolution. Conflicts bend around you rather than through you.',
    stats: { health: 90, inspiration: 20, attack: 10, defense: 50, wealth: 10 }
  },
  {
    id: 'challenger',
    label: 'Challenger',
    glyph: '◐',
    tagline: 'Testing the edges of every truth',
    description: 'High attack, low patience. You accelerate events for everyone around you.',
    stats: { health: 70, inspiration: 20, attack: 50, defense: 10, wealth: 20 }
  },
]

function statBar(value, max = 100) {
  const pct = Math.round((value / max) * 100)
  return `<div class="cc-stat-bar-bg"><div class="cc-stat-bar-fill" style="width:${pct}%"></div></div>`
}

function renderArchetypeCard(a, selected) {
  const s = a.stats
  return `
    <button class="cc-archetype-card${selected ? ' selected' : ''}" data-archetype="${a.id}" type="button">
      <div class="cca-glyph">${a.glyph}</div>
      <div class="cca-label">${a.label}</div>
      <div class="cca-tagline">${a.tagline}</div>
      <div class="cca-desc">${a.description}</div>
      <div class="cca-stats">
        <div class="cca-stat-row"><span>health</span>${statBar(s.health)}</div>
        <div class="cca-stat-row"><span>attack</span>${statBar(s.attack)}</div>
        <div class="cca-stat-row"><span>defense</span>${statBar(s.defense)}</div>
        <div class="cca-stat-row"><span>wealth</span>${statBar(s.wealth)}</div>
        <div class="cca-stat-row"><span>inspr.</span>${statBar(s.inspiration)}</div>
      </div>
    </button>
  `
}

export function renderCharacterCreator(userId, onComplete) {
  const root = document.getElementById('landing-screen')
  let selectedArchetype = ARCHETYPES[2] // default: Wanderer

  function draw() {
    root.innerHTML = `
      <div id="cc-wrap">
        <div id="cc-inner">
          <div id="cc-header">
            <div id="cc-title">Create your character</div>
            <div id="cc-subtitle">You will enter the world at its centre. The chronicle begins with you.</div>
          </div>

          <div id="cc-name-row">
            <label for="cc-name-input">Name</label>
            <input id="cc-name-input" type="text" maxlength="32" placeholder="your character's name…" autocomplete="off" spellcheck="false" />
          </div>

          <div id="cc-archetype-label">Archetype</div>
          <div id="cc-archetype-grid">
            ${ARCHETYPES.map(a => renderArchetypeCard(a, a.id === selectedArchetype.id)).join('')}
          </div>

          <div id="cc-confirm-row">
            <button id="cc-submit" type="button">ENTER THE WORLD</button>
            <div id="cc-msg"></div>
          </div>
        </div>
      </div>
    `

    // Archetype selection
    root.querySelectorAll('.cc-archetype-card').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedArchetype = ARCHETYPES.find(a => a.id === btn.dataset.archetype)
        draw()
        // Restore name value after re-render
        document.getElementById('cc-name-input').value =
          document.getElementById('cc-name-input')?.dataset?.saved || ''
      })
    })

    // Save name across re-renders via input event
    const nameEl = document.getElementById('cc-name-input')
    nameEl.addEventListener('input', () => { nameEl.dataset.saved = nameEl.value })

    // Submit
    document.getElementById('cc-submit').addEventListener('click', async () => {
      const name = document.getElementById('cc-name-input').value.trim()
      const msg  = document.getElementById('cc-msg')
      msg.textContent = ''

      if (!name) { msg.textContent = 'please enter a name'; return }
      if (name.length < 2) { msg.textContent = 'name must be at least 2 characters'; return }

      const btn = document.getElementById('cc-submit')
      btn.disabled = true
      btn.textContent = 'creating…'

      const archetype = selectedArchetype
      const attrs = { ...archetype.stats }

      // Insert into entities (the table app.js reads via loadCharacter)
      const { data, error } = await supabase
        .from('entities')
        .insert({
          owner_id:    userId,
          entity_type: 'character',
          name,
          archetype:   archetype.id,
          attributes:  attrs,
          x: 0, y: 0, z: 0,
        })
        .select('id, name, archetype, attributes, x, y, z')
        .single()

      if (error) {
        msg.textContent = error.message
        btn.disabled = false
        btn.textContent = 'ENTER THE WORLD'
        return
      }

      onComplete(data)
    })
  }

  draw()
}
