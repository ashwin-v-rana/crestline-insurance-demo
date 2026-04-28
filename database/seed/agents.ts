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

const AGENTS = [
  { email: 'alice@crestline.com', full_name: 'Alice Anderson', role: 'csr' },
  { email: 'bob@crestline.com',   full_name: 'Bob Bennett',    role: 'csr' },
  { email: 'carol@crestline.com', full_name: 'Carol Chen',     role: 'csr' },
  { email: 'dave@crestline.com',  full_name: 'Dave Davis',     role: 'csr' },
  { email: 'erin@crestline.com',  full_name: 'Erin Evans',     role: 'supervisor' },
]

async function main() {
  console.log(`Seeding ${AGENTS.length} agents with password: ${DEMO_PASSWORD}\n`)

  const password_hash = await bcrypt.hash(DEMO_PASSWORD, 10)

  for (const agent of AGENTS) {
    const { error } = await supabase
      .from('agents')
      .upsert(
        { ...agent, password_hash, must_change_password: false },
        { onConflict: 'email' },
      )
    if (error) {
      console.error(`  ✗  ${agent.email}: ${error.message}`)
    } else {
      console.log(`  ✓  ${agent.email.padEnd(28)} ${agent.full_name.padEnd(18)} ${agent.role}`)
    }
  }

  console.log(`\nDone. Log in with any email above + password '${DEMO_PASSWORD}'.`)
  console.log("To rotate a password later, run from core/ repo: npm run admin:set-password <email> <new>\n")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
