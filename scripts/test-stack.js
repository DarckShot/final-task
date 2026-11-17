import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:https';
import assert from 'node:assert/strict';
import {createPool} from '../src/db.js';

const exec=promisify(execFile);
const project=`final-task-test-${randomBytes(6).toString('hex')}`;
const dir=await mkdtemp(join(tmpdir(),'final-task-stack-'));
const secret=()=>randomBytes(32).toString('hex');
const env={...process.env,POSTGRES_PASSWORD:secret(),APP_DB_PASSWORD:secret(),REVIEWER_DB_PASSWORD:secret(),
  API_TOKEN:secret(),AUTHOR_LOGIN:'stack_test_author',AUTHOR_FULL_NAME:'Stack verification',
  DOMAIN:'localhost',ACME_EMAIL:'test@example.org'};
env.DATABASE_URL=`postgresql://tasks_app:${env.APP_DB_PASSWORD}@db:5432/tasks_db`;
const args=['compose','-p',project,'-f','compose.yaml','-f','compose.test.yaml'];
async function compose(...command) {
  try {return (await exec('docker',[...args,...command],{env,maxBuffer:4*1024*1024})).stdout.trim();}
  catch(error) {throw new Error(`Docker Compose ${command[0]} failed (exit ${error.code}); no credentials printed`);}
}
function get(url,ca,auth=true) {
  return new Promise((resolve,reject)=>{
    const req=request(url,{ca,headers:auth?{Authorization:`Bearer ${env.API_TOKEN}`} : {}},res=>{
      let text='';res.setEncoding('utf8');res.on('data',chunk=>{text+=chunk;});
      res.on('end',()=>resolve({status:res.statusCode,text}));
    });
    req.setTimeout(5000,()=>req.destroy(new Error('HTTPS timeout')));req.on('error',reject);req.end();
  });
}
let pool;
try {
  console.log('Starting isolated Compose stack with PostgreSQL, restricted roles and Caddy TLS…');
  await compose('up','-d','--wait','db');
  const dbPort=(await compose('port','db','5432')).split(':').at(-1);
  const testDatabaseUrl=`postgresql://tasks_owner:${env.POSTGRES_PASSWORD}@127.0.0.1:${dbPort}/tasks_db`;
  await compose('run','--rm','--build','setup','node','scripts/migrate.js');
  const rolesResult=await exec('npm',['run','test:roles'],{env:{...env,TEST_DATABASE_URL:testDatabaseUrl},maxBuffer:4*1024*1024});
  process.stdout.write(rolesResult.stdout);
  await compose('run','--rm','--build','setup');
  await compose('up','-d','--build','app','caddy');
  const httpsPort=(await compose('port','caddy','443')).split(':').at(-1);
  const origin=`https://localhost:${httpsPort}`;
  const root=join(dir,'root.crt');
  const caddy=await compose('ps','-q','caddy');
  let ca;
  for(let attempt=0;attempt<40;attempt++) {
    try {
      await exec('docker',['cp',`${caddy}:/data/caddy/pki/authorities/local/root.crt`,root]);
      ca=await readFile(root);
      const login=await get(`${origin}/login/`,ca,false);
      if(login.status===200) {assert.equal(login.text,env.AUTHOR_LOGIN);break;}
    } catch { /* CA generation and service startup are asynchronous. */ }
    if(attempt===39) throw new Error('Local HTTPS startup did not complete');
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  const reviewerUrl=`postgresql://tasks_reviewer:${env.REVIEWER_DB_PASSWORD}@127.0.0.1:${dbPort}/tasks_db`;
  for (const script of ['test:integration','test:ui']) {
    const result=await exec('npm',['run',script],{env:{...env,TEST_DATABASE_URL:testDatabaseUrl},maxBuffer:4*1024*1024});
    process.stdout.write(result.stdout);
  }
  await exec(process.execPath,['scripts/check-database.js'],{env:{...env,APP_URL:origin,REVIEWER_DATABASE_URL:reviewerUrl,NODE_EXTRA_CA_CERTS:root},maxBuffer:1024*1024});
  pool=createPool(reviewerUrl);
  // Synthetic fixture in a disposable DB; does not replace manual work on deployment.
  await pool.query('INSERT INTO tasks(id,owner_login,title,run_id) VALUES($1,$2,$3,$4)',[randomUUID(),env.AUTHOR_LOGIN,`Итоговая работа 24.10.2026: ${env.AUTHOR_LOGIN}`,'manual']);
  await exec(process.execPath,['scripts/check-deployment.js'],{env:{...env,APP_URL:origin,NODE_EXTRA_CA_CERTS:root},maxBuffer:1024*1024});
  const id=randomUUID();
  await pool.query('INSERT INTO tasks(id,owner_login,title,run_id) VALUES($1,$2,$3,$4)',[id,env.AUTHOR_LOGIN,'Persists across container restart','stack_persistence']);
  await compose('restart','app');
  let restored;
  for(let attempt=0;attempt<40;attempt++) {
    try {restored=await get(`${origin}/api/tasks/${id}/`,ca);if(restored.status===200) break;} catch {}
    if(attempt===39) throw new Error('App did not restart');
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.equal(JSON.parse(restored.text).title,'Persists across container restart');
  const index=await get(`${origin}/`,ca,false);assert.equal(index.status,200);assert.match(index.text,/Мои дела/);
  console.log('Stack PASS: initialization, PostgreSQL roles, verified local TLS, API↔reviewer SQL CRUD, persistence after app container restart, static page');
} finally {
  await pool?.end();
  // Only the random project created above; never touches the user's Compose project.
  await compose('down','--volumes','--remove-orphans');
  await rm(dir,{recursive:true,force:true});
}
