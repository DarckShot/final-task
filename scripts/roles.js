import {createPool} from '../src/db.js';
for (const key of ['ADMIN_DATABASE_URL','APP_DB_PASSWORD','REVIEWER_DB_PASSWORD']) {
  if (!process.env[key]) throw new Error(`Set ${key}`);
}
if ([process.env.APP_DB_PASSWORD,process.env.REVIEWER_DB_PASSWORD].some(p => p.length<24)) throw new Error('Use passwords of at least 24 characters');
const literal = value => `'${value.replaceAll("'","''")}'`;
const identifier = value => `"${value.replaceAll('"','""')}"`;
const pool = createPool(process.env.ADMIN_DATABASE_URL);
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const {rows:[{db}]} = await client.query('SELECT current_database() AS db');
  await client.query(`REVOKE ALL ON DATABASE ${identifier(db)} FROM PUBLIC`);
  await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  for (const [role,password] of [['tasks_app',process.env.APP_DB_PASSWORD],['tasks_reviewer',process.env.REVIEWER_DB_PASSWORD]]) {
    const existing = await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role]);
    if (existing.rowCount) throw new Error(`Role ${role} already exists; inspect before provisioning`);
    await client.query(`CREATE ROLE ${identifier(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${literal(password)}`);
    await client.query(`GRANT CONNECT ON DATABASE ${identifier(db)} TO ${identifier(role)}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${identifier(role)}`);
    await client.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.tasks TO ${identifier(role)}`);
  }
  await client.query('COMMIT');
  console.log('Restricted tasks_app and tasks_reviewer created');
} catch (error) {await client.query('ROLLBACK'); throw error;}
finally {client.release(); await pool.end();}
