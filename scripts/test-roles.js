import {randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createPool} from '../src/db.js';
import {taskStore} from '../src/db.js';
import {createApp} from '../src/app.js';
import {once} from 'node:events';
import {verifyDatabase} from './lib/verify-database.js';
if (!process.env.TEST_DATABASE_URL) throw new Error('Use a dedicated disposable database');
const admin=createPool(process.env.TEST_DATABASE_URL);
const appPassword=randomBytes(24).toString('hex');
const reviewerPassword=randomBytes(24).toString('hex');
let app,reviewer;
let provisioned=false;
let server;
const id=randomUUID();
try {
  const result=spawnSync(process.execPath,['scripts/roles.js'],{encoding:'utf8',env:{...process.env,ADMIN_DATABASE_URL:process.env.TEST_DATABASE_URL,APP_DB_PASSWORD:appPassword,REVIEWER_DB_PASSWORD:reviewerPassword}});
  assert.equal(result.status,0,result.stderr);
  provisioned=true;
  const urlFor=(name,password) => {const url=new URL(process.env.TEST_DATABASE_URL);url.username=name;url.password=password;return url.href;};
  app=createPool(urlFor('tasks_app',appPassword)); reviewer=createPool(urlFor('tasks_reviewer',reviewerPassword));
  await admin.query('CREATE TABLE private_test(secret text)');
  for (const pool of [app,reviewer]) {
    await pool.query('INSERT INTO tasks(id,owner_login,title,run_id) VALUES($1,$2,$3,$4)',[id,'roles-test','insert','roles-test']);
    assert.equal((await pool.query('SELECT * FROM tasks WHERE id=$1',[id])).rowCount,1);
    await pool.query('UPDATE tasks SET title=$1 WHERE id=$2',['updated',id]);
    assert.equal((await admin.query('SELECT title FROM tasks WHERE id=$1',[id])).rows[0].title,'updated');
    await pool.query('DELETE FROM tasks WHERE id=$1',[id]);
    for (const sql of ['SELECT * FROM private_test','CREATE TABLE forbidden(x int)','DROP TABLE tasks','TRUNCATE tasks','CREATE ROLE forbidden_role']) await assert.rejects(pool.query(sql),error => error.code==='42501');
  }
  const config={login:'roles-test-author',fullName:'Role verification',token:randomBytes(32).toString('hex'),reviewerToken:randomBytes(32).toString('hex')};
  server=createApp({config,store:taskStore(app,config.login)}).listen(0,'127.0.0.1');
  await once(server,'listening');
  await verifyDatabase({origin:`http://127.0.0.1:${server.address().port}`,token:config.token,login:config.login,pool:reviewer});
  console.log('Roles PASS: both roles can CRUD tasks; cannot read other tables, create/drop/truncate tables or create roles');
  console.log('Independent API↔SQL PASS: API uses tasks_app; independent SQL uses tasks_reviewer');
} finally {
  if(server) await new Promise(resolve=>server.close(resolve));
  await app?.end(); await reviewer?.end();
  if (provisioned) await admin.query('DROP TABLE IF EXISTS private_test');
  for (const name of provisioned ? ['tasks_app','tasks_reviewer'] : []) {
    if ((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[name])).rowCount) {
      await admin.query(`DROP OWNED BY ${name}`); await admin.query(`DROP ROLE ${name}`);
    }
  }
  await admin.end();
}
