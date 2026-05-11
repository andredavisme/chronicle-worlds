import { supabase } from './supabase-client.js'

let canvas, ctx
let entities      = [] // { entity_type, entity_id, x, y, z, effective_size }
let settingBounds = [] // { min_x, max_x, min_y, max_y, z, setting_id }
let gridCells     = [] // { x, y, z, setting_id } — all known cells for tinting
let localCharacterId = null

const BASE_TILE_W = 48
const MIN_TILE_W  = 20

// ─── Colour palette ──────────────────────────────────────────────────
// 10 hues evenly spaced. setting_id mod 10 → stable colour per setting.
const SETTING_PALETTE = [
  { h: 210, s: 55, l: 55 }, // blue-grey   (S1, S11…)
  { h:  35, s: 60, l: 52 }, // amber        (S2)
  { h: 150, s: 50, l: 42 }, // teal-green   (S3)
  { h: 280, s: 45, l: 58 }, // violet       (S4)
  { h:   5, s: 58, l: 52 }, // burnt-red    (S5)
  { h:  65, s: 55, l: 48 }, // olive        (S6)
  { h: 185, s: 60, l: 48 }, // cyan         (S7)
  { h: 320, s: 48, l: 55 }, // rose         (S8)
  { h: 100, s: 50, l: 45 }, // lime-green   (S9)
  { h: 245, s: 50, l: 58 }, // indigo       (S10)
]

function settingColour(settingId) {
  const p = SETTING_PALETTE[(settingId - 1) % SETTING_PALETTE.length]
  return {
    fill:   `hsla(${p.h}, ${p.s}%, ${p.l}%, 0.18)`,
    stroke: `hsla(${p.h}, ${p.s}%, ${p.l}%, 0.45)`,
    label:  `hsla(${p.h}, ${p.s}%, ${Math.min(p.l + 20, 80)}%, 0.75)`,
  }
}

export function setLocalCharacterId(id) {
  localCharacterId = id
  render()
}

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
  // Load all known grid cells for tinting (independent of entity occupancy)
  const { data: cells, error: cellsErr } = await supabase
    .from('grid_cells')
    .select('x, y, z, setting_id')
  if (!cellsErr) {
    gridCells = (cells || []).map(r => ({ x: r.x, y: r.y, z: r.z, setting_id: r.setting_id }))
  }

  // Load entities with their positions
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

  // Derive per-setting bounding boxes from the full grid_cells list
  const bySettingRaw = {}
  for (const cell of gridCells) {
    const sid = cell.setting_id
    if (sid == null) continue
    if (!bySettingRaw[sid]) bySettingRaw[sid] = { xs: [], ys: [], z: cell.z, setting_id: sid }
    bySettingRaw[sid].xs.push(cell.x)
    bySettingRaw[sid].ys.push(cell.y)
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

// Draw a single isometric diamond tile for one grid cell
function drawGridTile(cx, cy, cell, tw, th) {
  const { sx, sy } = isoProject(cell.x, cell.y, cell.z, tw, th)
  const hw = tw / 2  // half-width
  const hh = th / 2  // half-height
  const col = settingColour(cell.setting_id)

  ctx.beginPath()
  ctx.moveTo(cx + sx,      cy + sy - hh)  // top
  ctx.lineTo(cx + sx + hw, cy + sy)        // right
  ctx.lineTo(cx + sx,      cy + sy + hh)  // bottom
  ctx.lineTo(cx + sx - hw, cy + sy)        // left
  ctx.closePath()
  ctx.fillStyle = col.fill
  ctx.fill()
  ctx.strokeStyle = col.stroke
  ctx.lineWidth = 0.5
  ctx.stroke()
}

function drawSettingBoundary(cx, cy, bound, tw, th) {
  const col = settingColour(bound.setting_id)
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
  ctx.strokeStyle = col.stroke
  ctx.lineWidth = 1.5
  ctx.stroke()

  const top = corners.reduce((a, b) => a.sy < b.sy ? a : b)
  ctx.fillStyle = col.label
  ctx.font = '9px Courier New'
  ctx.textAlign = 'center'
  ctx.fillText(`S${bound.setting_id}`, cx + top.sx, cy + top.sy - 4)
  ctx.textAlign = 'left'
}

function drawLocalHighlight(cx, cy, sx, sy, r) {
  const gradient = ctx.createRadialGradient(
    cx + sx, cy + sy, r * 0.8,
    cx + sx, cy + sy, r * 2.2
  )
  gradient.addColorStop(0, 'rgba(100, 220, 100, 0.30)')
  gradient.addColorStop(1, 'rgba(100, 220, 100, 0.00)')
  ctx.beginPath()
  ctx.ellipse(cx + sx, cy + sy, r * 2.2, r * 2.2 * 0.55, 0, 0, Math.PI * 2)
  ctx.fillStyle = gradient
  ctx.fill()

  ctx.beginPath()
  ctx.ellipse(cx + sx, cy + sy, r * 1.65, r * 1.65 * 0.55, 0, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(100, 220, 100, 0.7)'
  ctx.lineWidth = 1.5
  ctx.stroke()
}

function render() {
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const cx = canvas.width  / 2
  const cy = canvas.height / 2
  const { tw, th } = getTileSize()

  // 1. Tile fill — draw every known cell tinted by setting
  for (const cell of gridCells) {
    drawGridTile(cx, cy, cell, tw, th)
  }

  // 2. Setting boundary outlines (on top of tiles, behind entities)
  for (const bound of settingBounds) {
    drawSettingBoundary(cx, cy, bound, tw, th)
  }

  // 3. Entities
  for (const e of entities) {
    const { sx, sy } = isoProject(e.x, e.y, e.z, tw, th)
    const r = Math.max(3, e.effective_size * (tw / 8))
    const isLocal = e.entity_type === 'character' && e.entity_id === localCharacterId

    if (isLocal) drawLocalHighlight(cx, cy, sx, sy, r)

    ctx.beginPath()
    ctx.ellipse(cx + sx, cy + sy, r, r * 0.55, 0, 0, Math.PI * 2)

    if (isLocal)                               ctx.fillStyle = '#44ee88'
    else if (e.entity_type === 'character')    ctx.fillStyle = '#6688ff'
    else if (e.entity_type === 'setting')      ctx.fillStyle = '#224422'
    else if (e.entity_type === 'material')     ctx.fillStyle = '#aa8844'
    else                                       ctx.fillStyle = '#444466'
    ctx.fill()

    if (tw >= 28) {
      ctx.fillStyle = isLocal ? '#aaffcc' : '#88aaff'
      ctx.font = `${Math.max(8, tw / 5)}px Courier New`
      ctx.fillText(`${e.entity_type[0].toUpperCase()}${e.entity_id}`, cx + sx + r + 2, cy + sy + 3)
    }
  }

  if (entities.length === 0 && gridCells.length === 0) {
    ctx.fillStyle = '#2a2a3a'
    ctx.font = `${Math.max(10, tw / 4)}px Courier New`
    ctx.textAlign = 'center'
    ctx.fillText('no entities in world', canvas.width / 2, canvas.height / 2)
    ctx.textAlign = 'left'
  }
}
