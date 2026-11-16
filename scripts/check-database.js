import {createPool} from '../src/db.js';
import {verifyDatabase} from './lib/verify-database.js';
for (const key of ['APP_URL','API_TOKEN','AUTHOR_LOGIN','REVIEWER_DATABASE_URL']) {
  if (!process.env[key]) throw new Error(`Set ${key}`);
}
const origin=new URL(process.env.APP_URL);
if (origin.protocol!=='https:' || origin.pathname!=='/' || origin.username || origin.password || origin.search || origin.hash) {
  throw new Error('APP_URL must be an HTTPS origin without credentials, query or subpath');
}
const pool=createPool(process.env.REVIEWER_DATABASE_URL);
try {
  console.log(JSON.stringify(await verifyDatabase({origin,token:process.env.API_TOKEN,login:process.env.AUTHOR_LOGIN,pool})));
} finally {await pool.end();}
