import { supabase } from './supabase-client.js'

const PER_PAGE = 40

export async function loadChronicle(listEl) {
  const { data, error } = await supabase
    .from('chronicle')
    .select('chronicle_id, timestamp, turn_number, branch_id, event_id, events(event_type, duration_units)')
    .order('timestamp', { ascending: false })
    .order('sequence_index', { ascending: false })
    .limit(PER_PAGE)
  // RLS automatically filters to player_id = auth.uid()

  if (error) { console.error('chronicle load:', error); return }

  renderChronicle(listEl, data || [])
}

function renderChronicle(listEl, entries) {
  if (entries.length === 0) {
    listEl.innerHTML = '<span style="color:#333">no chronicle entries yet</span>'
    return
  }

  listEl.innerHTML = entries.map(entry => {
    const branchClass = entry.branch_id > 0 ? `branch-${Math.min(entry.branch_id, 3)}` : ''
    const eventType = entry.events?.event_type ?? 'unknown'
    const duration = entry.events?.duration_units ?? '?'
    const branchLabel = entry.branch_id > 0 ? ` [branch ${entry.branch_id}]` : ''
    const t = entry.timestamp?.toFixed ? entry.timestamp.toFixed(2) : entry.timestamp

    return `<div class="chronicle-entry ${branchClass}">
      <span style="color:#555">t=${t}</span> 
      <span style="color:#8888cc">turn ${entry.turn_number}</span> 
      <span>${eventType}</span> 
      <span style="color:#444">${duration}u${branchLabel}</span>
    </div>`
  }).join('')
}

export function appendChronicleEntry(listEl, payload) {
  // Optimistic prepend from Realtime broadcast
  const div = document.createElement('div')
  div.className = 'chronicle-entry'
  div.innerHTML = `<span style="color:#555">live</span> <span style="color:#8888cc">turn ${payload.turn_number ?? '?'}</span> <span>${payload.action ?? ''}</span>`
  listEl.prepend(div)
}
