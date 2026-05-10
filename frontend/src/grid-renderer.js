import { supabase } from './supabase-client.js'

let canvas, ctx
let entities   = [] // { entity_type, entity_id, x, y, z, effective_size }
let settingBounds = [] // { min_x, max_x, min_y, max_y, z, setting_id }

const BASE_TILE_W = 48
const MIN_TILE_W  = 20

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
  canvas.width  = canvas.parentElement.clientWidth
  canvas.height = canvas.parentElement.clientHeight
}

export async function loadEntityPositions() {
  const { data, error } = await supabase
    .from('entity_positions')
    .select('entity_type, entity_id, effective_size, grid_cells(x, y, z, setting_id)')
    .is('timestamp_end', null)

  if (error) { console.error('entity_positions load:', error); return }

  entities = (data || []).map(row => ({
    entity_type:    row.entity_type,
    entity_id:      row.entity_id,
    effective_size: row.effective_size,
    x: row.grid_cells?.x ?? 0,
    y: row.grid_cells?.y ?? 0,
    z: row.grid_cells?.z ?? 0,
  }))

  // Derive per-setting bounding boxes from grid_cells data
  const bySettingRaw = {}
  for (const row of (data || [])) {
    const sid = row.grid_cells?.setting_id
    if (sid == null) continue
    if (!bySettingRaw[sid]) bySettingRaw[sid] = { xs: [], ys: [], z: row.grid_cells?.z ?? 0, setting_id: sid }
    bySettingRaw[sid].xs.push(row.grid_cells.x)
    bySettingRaw[sid].ys.push(row.grid_cells.y)
  }
  settingBounds = Object.values(bySettingRaw).map(s => ({
    setting_id: s.setting_id,
    min_x: Math.min(...s.xs), max_x: Math.max(...s.xs),
    min_y: Math.min(...s.ys), max_y: Math.max(...s.ys),
    z: s.z,
  }))

  render()
}

export function updateGrid(_payload) {
  loadEntityPositions()
}

function drawSettingBoundary(cx, cy, bound, tw, th) {
  // Draw the four corner-to-corner edges of the isometric bounding box
  const corners = [
    isoProject(bound.min_x - 0.5, bound.min_y - 0.5, bound.z, tw, th),
    isoProject(bound.max_x + 0.5, bound.min_y - 0.5, bound.z, tw, th),
    isoProject(bound.max_x + 0.5, bound.max_y + 0.5, bound.z, tw, th),
    isoProject(bound.min_x - 0.5, bound.max_y + 0.5, bound.z, tw, th),
  ]
  ctx.beginPath()
  ctx.moveTo(cx + corners[0].sx, cy + corners[0].sy)
  for (let i = 1; i < corners.length; i++) {
    ctx.lineTo(cx + corners[i].sx, cy + corners[i].sy)
  }
  ctx.closePath()
  ctx.strokeStyle = 'rgba(80, 80, 160, 0.35)'
  ctx.lineWidth = 1
  ctx.stroke()

  // Label
  const top = corners.reduce((a, b) => a.sy < b.sy ? a : b)
  ctx.fillStyle = 'rgba(80, 80, 160, 0.5)'
  ctx.font = '9px Courier New'
  ctx.textAlign = 'center'
  ctx.fillText(`S${bound.setting_id}`, cx + top.sx, cy + top.sy - 4)
  ctx.textAlign = 'left'
}

function render() {
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const cx = canvas.width  / 2
  const cy = canvas.height / 2
  const { tw, th } = getTileSize()

  // Draw setting boundaries first (behind entities)
  for (const bound of settingBounds) {
    drawSettingBoundary(cx, cy, bound, tw, th)
  }

  // Draw entities
  for (const e of entities) {
    const { sx, sy } = isoProject(e.x, e.y, e.z, tw, th)
    const r = Math.max(3, e.effective_size * (tw / 8))

    ctx.beginPath()
    ctx.ellipse(cx + sx, cy + sy, r, r * 0.55, 0, 0, Math.PI * 2)

    if (e.entity_type === 'character')    ctx.fillStyle = '#6688ff'
    else if (e.entity_type === 'setting') ctx.fillStyle = '#224422'
    else if (e.entity_type === 'material')ctx.fillStyle = '#aa8844'
    else                                  ctx.fillStyle = '#444466'
    ctx.fill()

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
