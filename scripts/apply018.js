const { Client } = require('pg');
const client = new Client({
  host: 'db.lgowhzdwriklgdpfdwot.supabase.co',
  port: 5432,
  user: 'postgres',
  password: 'motoversegarage123!',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
});
const sql = "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'staff'";
client.connect()
  .then(() => client.query(sql))
  .then(() => { console.log('Migration 018 applied'); return client.end(); })
  .catch(e => { console.error(e.message); client.end(); });
