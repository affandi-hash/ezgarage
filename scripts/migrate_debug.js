import pg from 'pg'
import { readFileSync } from 'fs'

const { Client } = pg

const client = new Client({
  connectionString: 'postgresql://postgres:motoversegarage123!@db.lgowhzdwriklgdpfdwot.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
})

const filePath = process.argv[2]
if (!filePath) { console.error('Usage: node scripts/migrate_debug.js <sql-file>'); process.exit(1) }

const sql = readFileSync(filePath, 'utf8')

// Split by semicolons, keeping DO $$ blocks intact
function splitStatements(sql) {
  const statements = []
  let current = ''
  let inDollarQuote = false
  let dollarTag = ''
  let i = 0
  while (i < sql.length) {
    // Check for dollar-quote start/end
    if (!inDollarQuote && sql[i] === '$') {
      const match = sql.slice(i).match(/^\$([^$]*)\$/)
      if (match) {
        dollarTag = match[0]
        inDollarQuote = true
        current += dollarTag
        i += dollarTag.length
        continue
      }
    } else if (inDollarQuote && sql.slice(i).startsWith(dollarTag)) {
      inDollarQuote = false
      current += dollarTag
      i += dollarTag.length
      continue
    }
    if (!inDollarQuote && sql[i] === ';') {
      const stmt = current.trim()
      const hasCode = stmt.replace(/--[^\n]*/g, '').trim()
      if (stmt && hasCode) statements.push(stmt)
      current = ''
    } else {
      current += sql[i]
    }
    i++
  }
  if (current.trim()) statements.push(current.trim())
  return statements
}

await client.connect()
const statements = splitStatements(sql)
console.log(`Running ${statements.length} statements...`)

for (let i = 0; i < statements.length; i++) {
  const stmt = statements[i]
  const preview = stmt.replace(/\s+/g, ' ').slice(0, 80)
  try {
    await client.query(stmt)
    console.log(`✓ [${i+1}/${statements.length}] ${preview}`)
  } catch (err) {
    console.error(`\n✗ FAILED at statement ${i+1}:`)
    console.error('Error:', err.message)
    console.error('Statement:\n', stmt.slice(0, 500))
    await client.end()
    process.exit(1)
  }
}
await client.end()
console.log('\n✓ All statements applied successfully.')
