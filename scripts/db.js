import pg from 'pg'

const { Client } = pg

const client = new Client({
  connectionString: 'postgresql://postgres:motoversegarage123!@db.lgowhzdwriklgdpfdwot.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
})

const sql = process.argv[2]

if (!sql) {
  console.error('Usage: node scripts/db.js "SQL query here"')
  process.exit(1)
}

await client.connect()
try {
  const result = await client.query(sql)
  if (result.rows?.length > 0) {
    console.table(result.rows)
  } else {
    console.log(`OK — ${result.rowCount ?? 0} rows affected`)
  }
} finally {
  await client.end()
}
