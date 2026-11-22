import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {createApp} from '../../src/app.js';
import {createPool,taskStore} from '../../src/db.js';

if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL required: use a dedicated disposable PostgreSQL database');
const pool = createPool(process.env.TEST_DATABASE_URL);
const config = {login:`test_${randomUUID()}`,fullName:'Тестовый автор',token:randomUUID(),reviewerToken:randomUUID()};
const runId = `test_${randomUUID()}`;
let server,base,task;
async function start(store=taskStore(pool,config.login)) {
  server=createApp({config,store}).listen(0,'127.0.0.1'); await once(server,'listening');
  base=`http://127.0.0.1:${server.address().port}`;
}
async function stop() {await new Promise(resolve => server.close(resolve));}
async function request(path,method='GET',body,token=config.token) {
  const res=await fetch(base+path,{method,headers:{...(token ? {Authorization:`Bearer ${token}`} : {}),...(body !== undefined ? {'Content-Type':'application/json'} : {})},body:body === undefined ? undefined : JSON.stringify(body)});
  const text=await res.text();
  if (text && path.startsWith('/api')) assert.match(res.headers.get('content-type'),/^application\/json/);
  return {status:res.status,body:text ? (path.startsWith('/api') ? JSON.parse(text) : text) : undefined,res};
}
before(async () => {
  await pool.query(await readFile(new URL('../../db/001_tasks.sql',import.meta.url),'utf8'));
  await start();
});
after(async () => {if(server) await stop(); await pool.query('DELETE FROM tasks WHERE owner_login=$1 OR run_id=$2',[config.login,runId]); await pool.end();});
test('public login and author with token',async () => {
  const login=await request('/login/','GET',undefined,null); assert.equal(login.status,200); assert.equal(login.body,config.login); assert.match(login.res.headers.get('content-type'),/^text\/plain/);
  assert.deepEqual((await request('/api/author/')).body,{login:config.login,fullName:config.fullName});
});
test('independent reviewer token grants the same task API access',async () => {
  assert.deepEqual((await request('/api/author/','GET',undefined,config.reviewerToken)).body,{login:config.login,fullName:config.fullName});
  assert.equal((await request('/api/author/','GET',undefined,'wrong')).status,401);
});
test('API responses remain 200 JSON even with conditional request headers',async()=>{
  const first=await request('/api/author/');
  const response=await fetch(base+'/api/author/',{headers:{Authorization:`Bearer ${config.token}`,'If-None-Match':first.res.headers.get('etag') || '"old-author"'}});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),first.body);
});
test('all API methods and unknown API paths require Bearer',async () => {
  for (const [path,method] of [['/api/author/','GET'],['/api/tasks/','POST'],['/api/tasks/?runId=x','GET'],[`/api/tasks/${randomUUID()}/`,'GET'],['/api/tasks/bad/','PATCH'],['/api/tasks/bad/','DELETE'],['/api/unknown','GET'],['/api','GET']]) {
    for (const token of [null,'wrong']) assert.equal((await request(path,method,undefined,token)).status,401);
  }
});
test('list validation, empty list, JSON failures and strict slashes',async () => {
  for (const query of ['','?runId=','?runId=a&runId=b','?runId=a%20b','?runId='+ 'x'.repeat(65)]) assert.equal((await request('/api/tasks/'+query)).status,400);
  assert.deepEqual((await request('/api/tasks/?runId=empty')).body,[]);
  for (const path of ['/api/author','/api/tasks']) assert.equal((await request(path)).status,404);
  const res=await fetch(base+'/api/tasks/',{method:'POST',headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},body:'{'});
  assert.equal(res.status,400); assert.deepEqual(Object.keys(await res.json()),['error']);
  for (const body of [null,[],{},true,{title:'x'},{title:' ',runId},{title:'x',runId,done:true},{title:'x',runId,ownerLogin:'attacker'},{title:'x',runId:'a/b'}]) assert.equal((await request('/api/tasks/','POST',body)).status,400);
});
test('create sets all six fields and API creation is immediately in SQL',async () => {
  const result=await request('/api/tasks/','POST',{title:'  integration  ',runId}); assert.equal(result.status,201); task=result.body;
  assert.deepEqual(Object.keys(task).sort(),['createdAt','done','id','ownerLogin','runId','title']);
  assert.match(task.id,/^[0-9a-f-]{36}$/); assert.equal(task.title,'integration'); assert.equal(task.done,false); assert.equal(task.ownerLogin,config.login); assert.equal(task.runId,runId);
  assert.equal(new Date(task.createdAt).toISOString(),task.createdAt);
  const {rows}=await pool.query('SELECT * FROM tasks WHERE id=$1',[task.id]); assert.equal(rows.length,1); assert.equal(rows[0].title,task.title);
  assert.deepEqual((await request(`/api/tasks/${task.id}/`)).body,task);
});
test('PATCH persists title, done=true and done=false; validation',async () => {
  const path=`/api/tasks/${task.id}/`;
  for (const body of [{},{done:1},{done:'true'},{done:null},{title:' '},{title:'x'.repeat(201)},{runId:'other'},{ownerLogin:'bad'}]) assert.equal((await request(path,'PATCH',body)).status,400);
  assert.equal((await request(path,'PATCH',{title:'renamed',done:true})).status,200);
  const {rows}=await pool.query('SELECT title,done FROM tasks WHERE id=$1',[task.id]); assert.deepEqual(rows[0],{title:'renamed',done:true});
  assert.equal((await request(path,'PATCH',{done:false})).body.done,false);
});
test('invalid text encoding is rejected as client input, not a database outage',async()=>{
  for(const title of ['a\u0000b','\ud800','\udc00']) {
    assert.equal((await request('/api/tasks/','POST',{title,runId})).status,400);
    assert.equal((await request(`/api/tasks/${task.id}/`,'PATCH',{title})).status,400);
  }
});
test('SQL-looking titles remain literal data and concurrent partial updates preserve both fields',async()=>{
  const title="'); DROP TABLE tasks; --";
  const created=await request('/api/tasks/','POST',{title,runId});assert.equal(created.status,201);
  const id=created.body.id;
  try {
    assert.equal((await pool.query('SELECT title FROM public.tasks WHERE id=$1',[id])).rows[0].title,title);
    const updates=await Promise.all([request(`/api/tasks/${id}/`,'PATCH',{title:'concurrent'}),request(`/api/tasks/${id}/`,'PATCH',{done:true})]);
    updates.forEach(response=>assert.equal(response.status,200));
    const stored=(await request(`/api/tasks/${id}/`)).body;assert.equal(stored.title,'concurrent');assert.equal(stored.done,true);
  } finally {await pool.query('DELETE FROM public.tasks WHERE id=$1',[id]);}
});
test('the application always uses the declared public.tasks table regardless of search_path',async()=>{
  const schema=`audit_${randomUUID().replaceAll('-','')}`;
  const client=await pool.connect();const id=randomUUID();
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`CREATE TABLE ${schema}.tasks (LIKE public.tasks INCLUDING ALL)`);
    await client.query(`SET search_path TO ${schema},public`);
    await taskStore(client,config.login).create(id,'declared table',runId);
    assert.equal((await pool.query('SELECT id FROM public.tasks WHERE id=$1',[id])).rowCount,1);
  } finally {
    await client.query('RESET search_path');
    await client.query('DELETE FROM public.tasks WHERE id=$1',[id]);
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);client.release();
  }
});
test('independent SQL update/insert are visible through API without cache',async () => {
  await pool.query('UPDATE tasks SET title=$1,done=true WHERE id=$2',['sql changed',task.id]);
  const got=(await request(`/api/tasks/${task.id}/`)).body; assert.equal(got.title,'sql changed'); assert.equal(got.done,true);
  const id=randomUUID(); await pool.query('INSERT INTO tasks(id,owner_login,title,run_id) VALUES($1,$2,$3,$4)',[id,config.login,'sql inserted',runId]);
  assert.ok((await request(`/api/tasks/?runId=${runId}`)).body.some(row => row.id===id));
  await pool.query('DELETE FROM tasks WHERE id=$1',[id]); assert.equal((await request(`/api/tasks/${id}/`)).status,404);
});
test('data persists across fresh app instance and fresh DB pool',async () => {
  await stop();
  const fresh=createPool(process.env.TEST_DATABASE_URL);
  try {await start(taskStore(fresh,config.login)); assert.equal((await request(`/api/tasks/${task.id}/`)).body.title,'sql changed'); await stop();}
  finally {await fresh.end(); await start();}
});
test('data persists across actual Node.js server process restart',async () => {
  const port=server.address().port;
  await stop();
  let child;
  async function boot() {
    child=spawn(process.execPath,['src/server.js'],{env:{...process.env,PORT:String(port),AUTHOR_LOGIN:config.login,AUTHOR_FULL_NAME:config.fullName,API_TOKEN:config.token,REVIEWER_API_TOKEN:config.reviewerToken,DATABASE_URL:process.env.TEST_DATABASE_URL},stdio:['ignore','pipe','pipe']});
    await Promise.race([
      once(child.stdout,'data'),
      once(child,'exit').then(([code]) => {throw new Error(`Child failed: ${code}`);})
    ]);
    base=`http://127.0.0.1:${port}`;
  }
  async function halt() {const exited=once(child,'exit'); child.kill('SIGTERM'); await exited; child=undefined;}
  try {
    await boot(); assert.equal((await request(`/api/tasks/${task.id}/`)).body.title,'sql changed'); await halt();
    await boot(); assert.equal((await request(`/api/tasks/${task.id}/`)).body.title,'sql changed'); await halt();
  } finally {if(child) await halt(); await start();}
});
test('other owner cannot be listed/read/updated/deleted',async () => {
  const id=randomUUID(); await pool.query('INSERT INTO tasks(id,owner_login,title,run_id) VALUES($1,$2,$3,$4)',[id,'another-owner','private',runId]);
  assert.ok(!(await request(`/api/tasks/?runId=${runId}`)).body.some(row => row.id===id));
  for (const method of ['GET','PATCH','DELETE']) assert.equal((await request(`/api/tasks/${id}/`,method,method==='PATCH'?{done:true}:undefined)).status,404);
});
test('UUID failures, missing records, deletion is empty 204 and SQL is updated',async () => {
  for (const method of ['GET','PATCH','DELETE']) {
    assert.equal((await request('/api/tasks/invalid/',method,method==='PATCH'?{title:'x'}:undefined)).status,400);
    assert.equal((await request(`/api/tasks/${randomUUID()}/`,method,method==='PATCH'?{title:'x'}:undefined)).status,404);
  }
  const result=await request(`/api/tasks/${task.id}/`,'DELETE'); assert.equal(result.status,204); assert.equal(result.body,undefined);
  assert.equal((await pool.query('SELECT * FROM tasks WHERE id=$1',[task.id])).rowCount,0);
  assert.equal((await request(`/api/tasks/${task.id}/`,'DELETE')).status,404);
});
test('unavailable real database returns JSON 503 for every task operation',async () => {
  await stop(); const offline=createPool('postgresql://nobody@127.0.0.1:1/missing');
  try {
    await start(taskStore(offline,config.login));
    for (const [path,method,body] of [[`/api/tasks/?runId=${runId}`,'GET'],['/api/tasks/','POST',{title:'x',runId}],[`/api/tasks/${randomUUID()}/`,'GET'],[`/api/tasks/${randomUUID()}/`,'PATCH',{done:true}],[`/api/tasks/${randomUUID()}/`,'DELETE']]) {
      const result=await request(path,method,body); assert.equal(result.status,503); assert.deepEqual(result.body,{error:'Database unavailable'});
    }
  } finally {await stop(); await offline.end(); await start();}
});
test('unexpected programming failures are not reported as database outages',async()=>{
  await stop();
  try {
    await start({list:async()=>{throw new TypeError('Synthetic programming error');}});
    const result=await request('/api/tasks/?runId=valid');
    assert.equal(result.status,500);assert.deepEqual(result.body,{error:'Internal server error'});
  } finally {await stop();await start();}
});
