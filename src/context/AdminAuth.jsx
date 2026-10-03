import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { AuthContext } from '../hooks/useAuth'
import { getSupabase } from '../lib/supabase'

export default function AdminAuth() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { pathname } = useLocation()

  useEffect(() => {
    let subscription
    try {
      // INITIAL_SESSION restores persisted auth; later events keep it in sync.
      const { data } = getSupabase().auth.onAuthStateChange((_event, next) => {
        setSession(next)
        setLoading(false)
      })
      subscription = data.subscription
    } catch {
      setError('Connection error')
      setLoading(false)
    }
    return () => subscription?.unsubscribe()
  }, [])

  // Anonymous player sessions must never unlock the admin area.
  const user =
    session?.user?.email && !session.user.is_anonymous ? session.user : null

  async function signIn(email, password) {
    setError('')
    try {
      const { data, error: signInError } =
        await getSupabase().auth.signInWithPassword({ email, password })
      if (signInError) {
        setError(
          signInError.status >= 500 || !signInError.status
            ? 'Connection error'
            : 'Invalid email/password',
        )
        return
      }
      setSession(data.session)
    } catch {
      setError('Connection error')
    }
  }

  async function logout() {
    setError('')
    try {
      const { error: signOutError } = await getSupabase().auth.signOut({
        scope: 'local',
      })
      if (signOutError) throw signOutError
      setSession(null)
    } catch {
      setError('Connection error')
    }
  }

  if (loading)
    return (
      <p role="status" className="preview-note">
        Loading…
      </p>
    )
  const loginPage = pathname === '/admin/login'
  if (!user && !loginPage) return <Navigate to="/admin/login" replace />
  if (user && loginPage) return <Navigate to="/admin" replace />

  return (
    <AuthContext.Provider
      value={{ user, session, loading, error, signIn, logout }}
    >
      <Outlet />
    </AuthContext.Provider>
  )
}
