// character-creator.js — Character creation using the real schema:
//   1. INSERT into characters (truth) → character_id
//   2. INSERT into entity_positions at origin grid cell
//   3. UPDATE players SET controlled_character_id
//   4. INSERT into entity_copies (reality_id=1) with player-chosen name
import { supabase } from './supabase-client.js'

const ROOT_REALITY_ID = 1

const ARCHETYPES = [
  {
    id: 'seeker',
    label: 'Seeker',
    glyph: '◎',
    tagline: 'Drawn to the unknown',
    description: 'You travel further and tire less. Other characters sense something restless in you — a question not yet answered.',
    stats: { health: 80, inspiration: 40, attack: 20, defense: 20, wealth: 20, material: 0, size: 1.0 }
  },
  {
    id: 'builder',
    label: 'Builder',
    glyph: '◧',
    tagline: 'Shaping what endures',
    description: 'Your wealth accumulates faster; exchanges favour you. What you make outlasts you.',
    stats: { health: 60, inspiration: 20, attack: 10, defense: 30, wealth: 60, material: 0, size: 1.2 }
  },
  {
    id: 'wanderer',
    label: 'Wanderer',
    glyph: '◈',
    tagline: 'Belonging everywhere, settled nowhere',
    description: 'Balanced across all dimensions. You arrive without expectation and leave without loss.',
    stats: { health: 60, inspiration: 30, attack: 25, defense: 25, wealth: 30, material: 0, size: 1.0 }
  },
  {
    id: 'keeper',
    label: 'Keeper',
    glyph: '◉',
    tagline: 'Holding the thread of what was',
    description: 'High defense, strong in resolution. Conflicts bend around you rather than through you.',
    stats: { health: 90, inspiration: 20, attack: 10, defense: 50, wealth: 10, material: 0, size: 1.3 }
  },
  {
    id: 'challenger',
    label: 'Challenger',
    glyph: '◐',
    tagline: 'Testing the edges of every truth',
    description: 'High attack, low patience. You accelerate events for everyone around you.',
    stats: { health: 70, inspiration: 20, attack: 50, defense: 10, wealth: 20, material: 0, size: 0.9 }
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

// ─── Core creation flow ───────────────────────────────────────────────────────
async function createCharacter(userId, name, archetype) {
  const s = archetype.stats

  // Step 1 — Insert truth character row
  const { data: charRow, error: charErr } = await supabase
    .from('characters')
    .insert({
      age:         0,
      health:      s.health,
      defense:     s.defense,
      attack:      s.attack,
      material:    s.material,
      wealth:      s.wealth,
      inspiration: s.inspiration,
      size:        s.size,
    })
    .select('character_id')
    .single()
  if (charErr) return { error: `characters insert: ${charErr.message}` }

  const characterId = charRow.character_id

  // Step 2 — Place character at origin grid cell (0, 0, 0) in setting 1
  const { data: cell, error: cellErr } = await supabase
    .from('grid_cells')
    .select('grid_cell_id')
    .eq('x', 0).eq('y', 0).eq('z', 0)
    .eq('setting_id', 1)
    .maybeSingle()
  if (cellErr) return { error: `grid_cells lookup: ${cellErr.message}` }
  if (!cell)   return { error: 'origin grid cell (0,0,0) not found — ensure migration 010 has been applied' }

  const { error: posErr } = await supabase
    .from('entity_positions')
    .insert({
      entity_type:    'character',
      entity_id:      characterId,
      grid_cell_id:   cell.grid_cell_id,
      effective_size: s.size,
      occupied_units: 1,
    })
  if (posErr) return { error: `entity_positions insert: ${posErr.message}` }

  // Step 3 — Link character to player row
  const { error: playerErr } = await supabase
    .from('players')
    .update({ controlled_character_id: characterId })
    .eq('player_id', userId)
  if (playerErr) return { error: `players update: ${playerErr.message}` }

  // Step 4 — Seed root-reality name in entity_copies
  const { error: copyErr } = await supabase
    .from('entity_copies')
    .insert({
      reality_id:       ROOT_REALITY_ID,
      truth_entity_type: 'character',
      truth_entity_id:  characterId,
      name,
      description:      `${archetype.label} — ${archetype.tagline}`,
      local_attributes: { archetype: archetype.id },
    })
  if (copyErr) return { error: `entity_copies insert: ${copyErr.message}` }

  return {
    ok: true,
    character: {
      id:          characterId,
      name,
      archetype:   archetype.id,
      attributes:  { health: s.health, defense: s.defense, attack: s.attack, wealth: s.wealth, inspiration: s.inspiration },
      x: 0, y: 0, z: 0,
    }
  }
}

// ─── UI ──────────────────────────────────────────────────────────────────────
export function renderCharacterCreator(userId, onComplete) {
  const root = document.getElementById('landing-screen')
  let selectedArchetype = ARCHETYPES[2] // default: Wanderer
  let savedName = ''

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
            <input id="cc-name-input" type="text" maxlength="32"
              placeholder="your character's name…"
              autocomplete="off" spellcheck="false"
              value="${savedName.replace(/"/g, '&quot;')}" />
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

    // Persist name across archetype re-renders
    const nameEl = document.getElementById('cc-name-input')
    nameEl.focus()
    nameEl.addEventListener('input', () => { savedName = nameEl.value })

    // Archetype selection
    root.querySelectorAll('.cc-archetype-card').forEach(btn => {
      btn.addEventListener('click', () => {
        savedName = document.getElementById('cc-name-input').value
        selectedArchetype = ARCHETYPES.find(a => a.id === btn.dataset.archetype)
        draw()
      })
    })

    // Submit
    document.getElementById('cc-submit').addEventListener('click', async () => {
      const name = document.getElementById('cc-name-input').value.trim()
      const msg  = document.getElementById('cc-msg')
      msg.textContent = ''

      if (!name)          { msg.textContent = 'please enter a name'; return }
      if (name.length < 2) { msg.textContent = 'name must be at least 2 characters'; return }

      const btn = document.getElementById('cc-submit')
      btn.disabled    = true
      btn.textContent = 'creating…'

      const result = await createCharacter(userId, name, selectedArchetype)

      if (result.error) {
        msg.textContent = result.error
        btn.disabled    = false
        btn.textContent = 'ENTER THE WORLD'
        return
      }

      onComplete(result.character)
    })
  }

  draw()
}
