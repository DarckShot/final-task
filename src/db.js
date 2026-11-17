import pg from 'pg';
export class DatabaseError extends Error {}
export function createPool(connectionString, {rootCert=process.env.PGSSLROOTCERT} = {}) {
  const url = new URL(connectionString);
  if (rootCert && !url.searchParams.has('sslrootcert')) url.searchParams.set('sslrootcert',rootCert);
  const pool = new pg.Pool({connectionString:url.href, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 10000});
  pool.on('error', () => console.error('PostgreSQL idle connection error'));
  return pool;
}
const fields = 'id, owner_login AS "ownerLogin", title, done, run_id AS "runId", created_at AS "createdAt"';
const serialize = row => row && ({...row, createdAt: new Date(row.createdAt).toISOString()});
export function taskStore(pool, login) {
  async function query(sql, params) {
    try {return await pool.query(sql,params);}
    catch (cause) {throw new DatabaseError('Database unavailable',{cause});}
  }
  return {
    async create(id, title, runId) {
      const {rows} = await query(`INSERT INTO public.tasks(id,owner_login,title,run_id) VALUES($1,$2,$3,$4) RETURNING ${fields}`, [id,login,title,runId]);
      return serialize(rows[0]);
    },
    async list(runId) {
      const {rows} = await query(`SELECT ${fields} FROM public.tasks WHERE owner_login=$1 AND run_id=$2 ORDER BY created_at,id`, [login,runId]);
      return rows.map(serialize);
    },
    async get(id) {
      const {rows} = await query(`SELECT ${fields} FROM public.tasks WHERE id=$1 AND owner_login=$2`, [id,login]);
      return serialize(rows[0]);
    },
    async update(id, data) {
      const {rows} = await query(`UPDATE public.tasks SET title=COALESCE($3,title),done=COALESCE($4,done) WHERE id=$1 AND owner_login=$2 RETURNING ${fields}`, [id,login,data.title ?? null,data.done ?? null]);
      return serialize(rows[0]);
    },
    async remove(id) {
      const result = await query('DELETE FROM public.tasks WHERE id=$1 AND owner_login=$2', [id,login]);
      return result.rowCount > 0;
    }
  };
}
