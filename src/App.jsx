import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Login from './pages/Login'
import Schedule from './pages/Schedule'
import { Button, Spinner } from './components/ui'

// Staff-only screens.
const Unassigned = lazy(() => import('./pages/Unassigned'))
const Requests = lazy(() => import('./pages/Requests'))
const Packages = lazy(() => import('./pages/Packages'))

// Public, no-login customer pages — their own chunk, so a customer never
// downloads the staff app and staff never download the booking flow.
const Book = lazy(() => import('./pages/public/Book'))
const BookSuccess = lazy(() =>
  import('./pages/public/BookResult').then((m) => ({ default: m.BookSuccess })),
)
const BookCancelled = lazy(() =>
  import('./pages/public/BookResult').then((m) => ({ default: m.BookCancelled })),
)
const MyLessons = lazy(() => import('./pages/public/MyLessons'))

/**
 * Where a user lands after signing in, decided by the role in public.users.
 *
 * Instructors open on their own column (the thing they check between lessons);
 * admins open on the full three-instructor view. Encoding it in the URL rather
 * than component state means a tab can be linked and shared.
 */
function landingPath(profile) {
  return profile.role === 'instructor'
    ? `/schedule?instructor=${profile.id}`
    : '/schedule?view=all'
}

function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-black text-fg-subtle">
      <Spinner className="h-6 w-6" />
    </div>
  )
}

/**
 * Signed in to Supabase Auth but with no public.users row — the account exists
 * but was never given a role, so there is nothing sensible to show.
 */
function MissingProfile() {
  const { session, signOut } = useAuth()
  return (
    <div className="flex min-h-dvh items-center justify-center bg-black px-4">
      <div className="animate-scale-in max-w-sm rounded-2xl bg-surface p-6 text-center shadow-2xl shadow-black/60 ring-1 ring-line">
        <h1 className="text-base font-semibold text-fg">
          Account not set up
        </h1>
        <p className="mt-2 text-sm text-fg-muted">
          {session?.user?.email} can sign in, but has no staff record yet. An
          admin needs to add a row in <code className="text-xs text-fg-subtle">users</code>{' '}
          with a role.
        </p>
        <Button onClick={signOut} className="mt-4">
          Sign out
        </Button>
      </div>
    </div>
  )
}

function RequireAuth({ children }) {
  const { session, profile, loading } = useAuth()

  if (loading) return <FullPageSpinner />
  if (!session) return <Navigate to="/login" replace />
  if (!profile) return <MissingProfile />

  return children
}

function LoginRoute() {
  const { session, profile, loading } = useAuth()

  if (loading) return <FullPageSpinner />
  if (session && profile) return <Navigate to={landingPath(profile)} replace />
  if (session && !profile) return <MissingProfile />

  return <Login />
}

function RootRedirect() {
  const { session, profile, loading } = useAuth()

  if (loading) return <FullPageSpinner />
  if (!session) return <Navigate to="/login" replace />
  if (!profile) return <MissingProfile />

  return <Navigate to={landingPath(profile)} replace />
}

/** Admin screens: signed in AND admin_access. RLS enforces the same thing. */
function RequireAdmin({ children }) {
  const { isAdmin } = useAuth()
  return (
    <RequireAuth>
      {isAdmin ? children : <Navigate to="/schedule" replace />}
    </RequireAuth>
  )
}

export default function App() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        {/* Public customer pages — no login. */}
        <Route path="/book" element={<Book />} />
        <Route path="/book/success" element={<BookSuccess />} />
        <Route path="/book/cancelled" element={<BookCancelled />} />
        <Route path="/my-lessons" element={<MyLessons />} />

        {/* Staff. */}
        <Route path="/login" element={<LoginRoute />} />
        <Route
          path="/schedule"
          element={
            <RequireAuth>
              <Schedule />
            </RequireAuth>
          }
        />
        <Route
          path="/unassigned"
          element={
            <RequireAdmin>
              <Unassigned />
            </RequireAdmin>
          }
        />
        <Route
          path="/requests"
          element={
            <RequireAdmin>
              <Requests />
            </RequireAdmin>
          }
        />
        <Route
          path="/packages"
          element={
            <RequireAdmin>
              <Packages />
            </RequireAdmin>
          }
        />
        <Route path="/" element={<RootRedirect />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
