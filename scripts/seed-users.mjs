/**
 * Seed the five internal users.
 *
 * There is no public signup, so accounts are created here (or by hand in the
 * Supabase dashboard). The on_auth_user_created trigger reads user_metadata
 * { name, role } and creates the matching public.users row automatically.
 *
 * Requires a secret key — never ship this to the browser. Run:
 *   SUPABASE_SECRET_KEY=sb_secret_xxx node scripts/seed-users.mjs
 *
 * Idempotent: an account that already exists is skipped, not overwritten.
 */

const PROJECT_REF = 'wdbdmosddtktumfnioqi'
const AUTH_URL = `https://${PROJECT_REF}.supabase.co/auth/v1/admin/users`
const SECRET = process.env.SUPABASE_SECRET_KEY

if (!SECRET) {
  console.error('Missing SUPABASE_SECRET_KEY. Find it under')
  console.error('Dashboard -> Project Settings -> API keys -> secret key.')
  process.exit(1)
}

// Placeholder identities so the app is testable end to end.
// Replace the emails/names with the real staff before going live.
const TEMP_PASSWORD = process.env.SEED_PASSWORD ?? 'SdkTemp2026!'

const USERS = [
  { email: 'admin.alex@example.com', name: 'Alex Morgan', role: 'admin' },
  { email: 'admin.sam@example.com', name: 'Sam Patel', role: 'admin' },
  { email: 'jordan@example.com', name: 'Jordan Lee', role: 'instructor' },
  { email: 'riley@example.com', name: 'Riley Chen', role: 'instructor' },
  { email: 'casey@example.com', name: 'Casey Novak', role: 'instructor' },
]

const headers = {
  apikey: SECRET,
  Authorization: `Bearer ${SECRET}`,
  'Content-Type': 'application/json',
}

for (const user of USERS) {
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email: user.email,
      password: TEMP_PASSWORD,
      email_confirm: true, // internal accounts, skip the confirmation email
      user_metadata: { name: user.name, role: user.role },
    }),
  })

  const body = await res.json().catch(() => ({}))

  if (res.ok) {
    console.log(`created  ${user.role.padEnd(10)} ${user.email}`)
  } else if (/already been registered|already exists/i.test(JSON.stringify(body))) {
    console.log(`exists   ${user.role.padEnd(10)} ${user.email}`)
  } else {
    console.error(`FAILED   ${user.email}:`, body.msg ?? body.message ?? body)
  }
}

console.log(`\nTemp password for all seeded accounts: ${TEMP_PASSWORD}`)
console.log('Change these before real use.')
