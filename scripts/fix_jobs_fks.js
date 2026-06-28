const { Client } = require('pg');
const client = new Client({
  host: 'db.lgowhzdwriklgdpfdwot.supabase.co',
  port: 5432,
  user: 'postgres',
  password: 'motoversegarage123!',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
});
const sql = `
  ALTER TABLE jobs
    ADD CONSTRAINT jobs_assigned_foreman_id_fkey
      FOREIGN KEY (assigned_foreman_id) REFERENCES users(id) ON DELETE SET NULL,
    ADD CONSTRAINT jobs_assigned_mechanic_id_fkey
      FOREIGN KEY (assigned_mechanic_id) REFERENCES users(id) ON DELETE SET NULL;

  NOTIFY pgrst, 'reload schema';
`;
client.connect()
  .then(() => client.query(sql))
  .then(() => { console.log('FKs added + schema reloaded'); return client.end(); })
  .catch(e => { console.error(e.message); client.end(); });
