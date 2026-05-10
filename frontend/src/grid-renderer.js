import { supabase } from './supabase-client.js'

let canvas, ctx
let entities = [] // { entity_type, entity_id, x, y, z, effective_size }

// Tile size is computed dynamically in render() based on canvas width
// so the isometric grid scales on any screen size.
const BASE_TILE_W = 48 // target tile width at ~800px canvas
const MIN_TILE_W  = 20 // floor for very small screens

function getTileSize() {
  if (!canvas) return { tw: BASE_TILE_W, th: BASE_TILE_W / 2 }
  const scale = Math.max(MIN_TILE_W / BASE_TILE_W, Math.min(1, canvas.width / 800))
  const tw = Math.round(BASE_TILE_W * scale)
  return { tw, th: Math.round(tw / 2) }
}

function isoProject(x, y, z, tw, th) {
  return {
    sx: (x - y) * (tw / 2),
    sy: (x + y) * (th / 2) - z * th,
  }
}

export function initGridRenderer(canvasEl) {
  canvas = canvasEl
  ctx = canvas.getContext('2d')
  resizeCanvas()
  window.addEventListener('resize', () => { resizeCanvas(); render() })
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
  loadEntityPositions()
}

function render() {
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const cx = canvas.width / 2
  const cy = canvas.height / 2
  const { tw, th } = getTileSize()

  for (const e of entities) {
    const { sx, sy } = isoProject(e.x, e.y, e.z, tw, th)
    const r = Math.max(3, e.effective_size * (tw / 8))

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

    // Hide label on very small tiles to avoid clutter
    if (tw >= 28) {
      ctx.fillStyle = '#88aaff'
      ctx.font = `${Math.max(8, tw / 5)}px Courier New`
      ctx.fillText(`${e.entity_type[0].toUpperCase()}${e.entity_id}`, cx + sx + r + 2, cy + sy + 3)
    }
  }

  if (entities.length === 0) {
    ctx.fillStyle = '#2a2a3a'
    ctx.font = `${Math.max(10, tw / 4)}px Courier New`
    ctx.textAlign = 'center'
    ctx.fillText('no entities in world', canvas.width / 2, canvas.height / 2)
    ctx.textAlign = 'left'
  }
}
