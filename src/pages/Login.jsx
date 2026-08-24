import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Spinner } from '../components/ui'
import DotMatrixBackground from '../components/ui/dot-matrix-background'
import { supabase } from '../lib/supabase'

// The reference design's exact values, kept in one place so the card, inputs and
// button stay consistent. This screen is deliberately the only dark surface in
// the app — everything past sign-in is the light scheduling UI.
// 16px on mobile, the design's 14px from `sm` up — iOS Safari auto-zooms on
// focus for anything smaller and never zooms back out.
const inputClass =
  'w-full rounded-md border border-[#333] bg-black px-[0.85rem] py-[0.65rem] text-base sm:text-[0.875rem] text-white outline-none transition placeholder:text-[#555] focus:border-[#666]'

export default function Login() {
  const { signIn } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)

    // Supabase Auth is keyed on email, so resolve the username to its email
    // via a SECURITY DEFINER lookup (public.email_for_username) before
    // signing in. Same generic message either way — don't let a wrong
    // username and a wrong password be distinguishable.
    const { data: email, error: lookupError } = await supabase.rpc(
      'email_for_username',
      { p_username: username.trim().toLowerCase() },
    )

    if (lookupError || !email) {
      setError('Wrong username or password.')
      setBusy(false)
      return
    }

    const { error: signInError } = await signIn(email, password)

    if (signInError) {
      setError(
        signInError.message === 'Invalid login credentials'
          ? 'Wrong username or password.'
          : signInError.message,
      )
      setBusy(false)
      return
    }

    // On success the auth listener swaps the route; leave the button disabled
    // so a double submit can't fire.
  }

  return (
    <div className="relative flex h-dvh w-full items-center justify-center overflow-hidden bg-black px-4 py-6 text-white sm:py-12">
      <DotMatrixBackground className="z-0" />

      {/* Vignette — dims the dots behind the card so the form stays readable. */}
      <div className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(circle_at_center,rgba(0,0,0,0.75)_0%,rgba(0,0,0,0)_100%)]" />

      <div className="relative z-[2] flex max-h-full w-full max-w-[400px] flex-col items-center overflow-y-auto rounded-xl border border-[#222] bg-[#121212] p-6 shadow-[0_10px_40px_rgba(0,0,0,0.8)] sm:p-8">
        <div className="flex w-full max-w-[360px] flex-col items-center text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-[#333] bg-[#111] text-sm font-bold tracking-tight">
            SDK
          </div>

          <h1 className="mb-1 text-[1.35rem] font-semibold tracking-[-0.025em]">
            Sign in to SDK
          </h1>
          <p className="mb-[0.85rem] text-[0.85rem] leading-[1.5] text-[#888]">
            Driving school scheduling.
          </p>

          <form
            onSubmit={onSubmit}
            className="flex w-full flex-col gap-[0.65rem]"
          >
            <input
              type="text"
              required
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              aria-label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={inputClass}
              placeholder="Username"
            />

            <input
              type="password"
              required
              autoComplete="current-password"
              aria-label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              placeholder="Password"
            />

            {error && (
              <div
                role="alert"
                className="rounded-md border border-red-900/70 bg-red-950/60 px-3 py-2 text-left text-[0.8rem] leading-[1.4] text-red-300"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-[#ededed] py-[0.65rem] text-[0.875rem] font-medium text-black transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy && <Spinner />}
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="my-[0.85rem] h-px w-full bg-[#222]" />

          <p className="text-[0.75rem] leading-[1.5] text-[#666]">
            Internal staff access only. Accounts are created by an admin —
            there is no self-signup.
          </p>
        </div>
      </div>
    </div>
  )
}
