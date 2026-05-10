import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://hhyhulqngdkwsxhymmcd.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_haKvwV0M7KMj4Qz69M6WGg_KmIfU-aI'

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)

// Auth helpers
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  return data
}

export async function signOut() {
  await supabase.auth.signOut()
}

export function getSession() {
  return supabase.auth.getSession()
}

export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange(callback)
}
