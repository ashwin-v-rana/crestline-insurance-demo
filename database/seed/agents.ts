import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'
import 'dotenv/config'

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  console.error('Copy .env.example to .env and fill in values from your Supabase project.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const DEMO_PASSWORD = 'DemoPass123!'
const ADMIN_PASSWORD = 'CrestlineAdmin123!'

const AGENTS = [
  { email: 'admin@crestline.com', full_name: 'Crestline Admin', role: 'admin',      password: ADMIN_PASSWORD, must_change_password: true },
  { email: 'alice@crestline.com', full_name: 'Alice Anderson',  role: 'csr',        password: DEMO_PASSWORD,  must_change_password: false },
  { email: 'bob@crestline.com',   full_name: 'Bob Bennett',     role: 'csr',        password: DEMO_PASSWORD,  must_change_password: false },
  { email: 'carol@crestline.com', full_name: 'Carol Chen',      role: 'csr',        password: DEMO_PASSWORD,  must_change_password: false },
  { email: 'dave@crestline.com',  full_name: 'Dave Davis',      role: 'csr',        password: DEMO_PASSWORD,  must_change_password: false },
  { email: 'erin@crestline.com',  full_name: 'Erin Evans',      role: 'supervisor', password: DEMO_PASSWORD,  must_change_password: false },
]

async function main() {
  console.log(`Seeding ${AGENTS.length} agents…\n`)

  for (const agent of AGENTS) {
    const password_hash = await bcrypt.hash(agent.password, 10)
    const { error } = await supabase
      .from('agents')
      .upsert(
        { email: agent.email, full_name: agent.full_name, role: agent.role, password_hash, must_change_password: agent.must_change_password },
        { onConflict: 'email' },
      )
    if (error) {
      console.error(`  ✗  ${agent.email}: ${error.message}`)
    } else {
      console.log(`  ✓  ${agent.email.padEnd(28)} ${agent.full_name.padEnd(18)} ${agent.role}`)
    }
  }

  console.log(`\nDone.`)
  console.log(`  Admin:  admin@crestline.com / ${ADMIN_PASSWORD}  (must change on first login)`)
  console.log(`  Agents: alice/bob/carol/dave/erin@crestline.com / ${DEMO_PASSWORD}`)
  console.log("  To rotate a password later, run from core/ repo: npm run admin:set-password <email> <new>\n")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
