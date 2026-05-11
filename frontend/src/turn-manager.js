import { supabase } from './supabase-client.js'

const COOLDOWN_MS = 60_000 // 1 real minute — UX only, not server-enforced
const DEFAULT_SETTING_ID = 1

let cooldownEnd = 0
let cooldownTimer = null
let onCooldownUpdate = null // callback(secondsRemaining)
let onTurnResult = null    // callback(result)
let onDisabledChange = null // callback(disabled: boolean)

export function initTurnManager({ onCooldown, onResult, onDisabled }) {
  onCooldownUpdate  = onCooldown
  onTurnResult      = onResult
  onDisabledChange  = onDisabled ?? null
}

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
        setting_id: DEFAULT_SETTING_ID,
        submit_timestamp,
        sequence_index: Math.floor(Math.random() * 1_000_000),
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
  onDisabledChange?.(true)
  clearInterval(cooldownTimer)
  cooldownTimer = setInterval(() => {
    const remaining = Math.ceil((cooldownEnd - Date.now()) / 1000)
    if (remaining <= 0) {
      clearInterval(cooldownTimer)
      onCooldownUpdate?.(0)
      onDisabledChange?.(false)
    } else {
      onCooldownUpdate?.(remaining)
    }
  }, 1000)
}

export function resetCooldown() {
  startCooldown()
}

export function getCooldownRemaining() {
  return Math.max(0, Math.ceil((cooldownEnd - Date.now()) / 1000))
}
