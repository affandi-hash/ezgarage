const { Client } = require('pg');
const client = new Client({
  host: 'db.lgowhzdwriklgdpfdwot.supabase.co',
  port: 5432,
  user: 'postgres',
  password: 'motoversegarage123!',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
});
client.connect()
  .then(() => client.query(`
    SELECT tc.constraint_name, kcu.column_name, ccu.table_name AS foreign_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = 'jobs'
    ORDER BY kcu.column_name;
  `))
  .then(r => { console.log(r.rows); return client.end(); })
  .catch(e => { console.error(e.message); client.end(); });
