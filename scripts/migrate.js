import pg from 'pg'
import { readFileSync } from 'fs'

const { Client } = pg

const client = new Client({
  connectionString: 'postgresql://postgres:motoversegarage123!@db.lgowhzdwriklgdpfdwot.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
})

const filePath = process.argv[2]
if (!filePath) {
  console.error('Usage: node scripts/migrate.js <path-to-sql-file>')
  process.exit(1)
}

const sql = readFileSync(filePath, 'utf8')

await client.connect()
try {
  await client.query(sql)
  console.log(`✓ Migration applied: ${filePath}`)
} catch (err) {
  console.error('✗ Migration failed:', err.message)
  if (err.position) {
    const pos = parseInt(err.position)
    const snippet = sql.slice(Math.max(0, pos - 200), pos + 200)
    console.error('Position:', pos)
    console.error('Near:\n---\n' + snippet + '\n---')
  }
  process.exit(1)
} finally {
  await client.end()
}
