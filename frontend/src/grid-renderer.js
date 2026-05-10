import { supabase } from './supabase-client.js'

let canvas, ctx
let entities = [] // { entity_type, entity_id, x, y, z, effective_size }

// Isometric projection constants
const TILE_W = 48
const TILE_H = 24
const ORIGIN_X = 0
const ORIGIN_Y = 0

function isoProject(x, y, z) {
  // Project 3D grid coords to 2D canvas (isometric)
  return {
    sx: (x - y) * (TILE_W / 2),
    sy: (x + y) * (TILE_H / 2) - z * TILE_H,
  }
}

export function initGridRenderer(canvasEl) {
  canvas = canvasEl
  ctx = canvas.getContext('2d')
  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)
  render()
}

function resizeCanvas() {
  canvas.width = canvas.parentElement.clientWidth
  canvas.height = canvas.parentElement.clientHeight
}

export async function loadEntityPositions() {
  const { data, error } = await supabase
    .from('entity_positions')
    .select('entity_type, entity_id, effective_size, grid_cells(x, y, z)')
    .is('timestamp_end', null) // currently active positions only

  if (error) { console.error('entity_positions load:', error); return }

  entities = (data || []).map(row => ({
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    effective_size: row.effective_size,
    x: row.grid_cells?.x ?? 0,
    y: row.grid_cells?.y ?? 0,
    z: row.grid_cells?.z ?? 0,
  }))
  render()
}

export function updateGrid(payload) {
  // Called from Realtime turn_resolved broadcast — reload positions
  loadEntityPositions()
}

function render() {
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const cx = canvas.width / 2
  const cy = canvas.height / 2

  // Draw each entity as an isometric dot
  for (const e of entities) {
    const { sx, sy } = isoProject(e.x, e.y, e.z)
    const r = Math.max(4, e.effective_size * 6)

    ctx.beginPath()
    ctx.ellipse(cx + sx, cy + sy, r, r * 0.55, 0, 0, Math.PI * 2)

    if (e.entity_type === 'character') {
      ctx.fillStyle = '#6688ff'
    } else if (e.entity_type === 'setting') {
      ctx.fillStyle = '#224422'
    } else {
      ctx.fillStyle = '#444466'
    }
    ctx.fill()

    // Label
    ctx.fillStyle = '#88aaff'
    ctx.font = '9px Courier New'
    ctx.fillText(`${e.entity_type[0].toUpperCase()}${e.entity_id}`, cx + sx + r + 2, cy + sy + 3)
  }

  // Empty state
  if (entities.length === 0) {
    ctx.fillStyle = '#2a2a3a'
    ctx.font = '12px Courier New'
    ctx.textAlign = 'center'
    ctx.fillText('no entities in world', canvas.width / 2, canvas.height / 2)
    ctx.textAlign = 'left'
  }
}
