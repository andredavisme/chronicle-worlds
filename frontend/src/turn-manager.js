import { supabase } from './supabase-client.js'

const COOLDOWN_MS = 60_000 // 1 real minute — UX only, not server-enforced
const DEFAULT_SETTING_ID = 1 // genesis setting; update if world has multiple settings

let cooldownEnd = 0
let cooldownTimer = null
let onCooldownUpdate = null // callback(secondsRemaining)
let onTurnResult = null    // callback(result)

export function initTurnManager({ onCooldown, onResult }) {
  onCooldownUpdate = onCooldown
  onTurnResult = onResult
}

// Submit an action to the resolve-turn Edge Function
export async function submitAction(action, details = {}) {
  const now = Date.now()
  if (now < cooldownEnd) {
    const remaining = Math.ceil((cooldownEnd - now) / 1000)
    onCooldownUpdate?.(remaining)
    return { status: 'cooldown', remaining }
  }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  const submit_timestamp = now / 1000

  const { data, error } = await supabase.functions.invoke('resolve-turn', {
    body: {
      action,
      player_id: session.user.id,
      details: {
        setting_id: DEFAULT_SETTING_ID, // required — events.setting_id NOT NULL
        submit_timestamp,
        sequence_index: Math.floor(Math.random() * 1_000_000), // tiebreaker
        ...details,
      },
    },
  })

  if (error) throw error

  if (data.status === 'resolved') {
    startCooldown()
  }

  onTurnResult?.(data)
  return data
}

function startCooldown() {
  cooldownEnd = Date.now() + COOLDOWN_MS
  clearInterval(cooldownTimer)
  cooldownTimer = setInterval(() => {
    const remaining = Math.ceil((cooldownEnd - Date.now()) / 1000)
    if (remaining <= 0) {
      clearInterval(cooldownTimer)
      onCooldownUpdate?.(0)
    } else {
      onCooldownUpdate?.(remaining)
    }
  }, 1000)
}

export function resetCooldown() {
  // Called by Realtime broadcast on turn_resolved
  startCooldown()
}

export function getCooldownRemaining() {
  return Math.max(0, Math.ceil((cooldownEnd - Date.now()) / 1000))
}
