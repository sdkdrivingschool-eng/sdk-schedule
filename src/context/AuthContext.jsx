import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

/**
 * Session + profile.
 *
 * The role comes from public.users, not auth metadata — metadata is
 * self-declared at signup and RLS never reads it, so trusting it here would
 * let the UI and the database disagree about who is an admin.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session ?? null)
      if (!data.session) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return
      setSession(next ?? null)
      if (!next) {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const userId = session?.user?.id

  useEffect(() => {
    if (!userId) return

    let active = true
    setLoading(true)

    supabase
      .from('users')
      .select('id, email, name, role')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return
        if (error) console.error('Failed to load profile', error)
        setProfile(data ?? null)
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [userId])

  const value = useMemo(
    () => ({
      session,
      profile,
      loading,
      isAdmin: profile?.role === 'admin',
      signIn: (email, password) =>
        supabase.auth.signInWithPassword({ email, password }),
      signOut: () => supabase.auth.signOut(),
    }),
    [session, profile, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
