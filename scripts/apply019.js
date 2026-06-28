const { Client } = require('pg');
const client = new Client({
  host: 'db.lgowhzdwriklgdpfdwot.supabase.co',
  port: 5432,
  user: 'postgres',
  password: 'motoversegarage123!',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
});
// Allow anonymous users to INSERT bookings from the public /book page
// and to SELECT branches (to populate the branch dropdown)
const sql = `
  DROP POLICY IF EXISTS "bookings_anon_insert" ON bookings;
  CREATE POLICY "bookings_anon_insert" ON bookings
    FOR INSERT TO anon
    WITH CHECK (source = 'online');

  DROP POLICY IF EXISTS "branches_anon_select" ON branches;
  CREATE POLICY "branches_anon_select" ON branches
    FOR SELECT TO anon
    USING (true);
`;
client.connect()
  .then(() => client.query(sql))
  .then(() => { console.log('Migration 019 applied (anon booking + branch policies)'); return client.end(); })
  .catch(e => { console.error(e.message); client.end(); });
