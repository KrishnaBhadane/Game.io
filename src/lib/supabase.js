import { createClient } from '@supabase/supabase-js'

let client

// Initialize on first use so the base app also runs without backend credentials.
export function getSupabase() {
  if (client) return client

  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

  if (!url || !key) {
    throw new Error(
      'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env, then restart Vite.',
    )
  }

  if (key.startsWith('sb_secret_')) {
    throw new Error('Use a public anon/publishable key, never a server secret.')
  }

  client = createClient(url, key)
  return client
}
