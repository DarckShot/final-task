import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const origin=process.env.APP_URL;
if (!origin || new URL(origin).protocol!=='https:') throw new Error('Set APP_URL to the public HTTPS origin');
if (!process.env.API_TOKEN) throw new Error('API_TOKEN is required');
const runId=`verify_${randomUUID()}`;
let id;
async function request(path,method='GET',body,auth=true) {
  return fetch(new URL(path,origin),{method,headers:{...(auth?{Authorization:`Bearer ${process.env.API_TOKEN}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000),redirect:'error'});
}
try {
  const login=await request('/login/','GET',undefined,false); assert.equal(login.status,200); assert.match(login.headers.get('content-type'),/^text\/plain/); assert.equal(await login.text(),process.env.AUTHOR_LOGIN);
  assert.equal((await request('/api/author/','GET',undefined,false)).status,401);
  const author=await request('/api/author/'); assert.equal(author.status,200); assert.deepEqual(await author.json(),{login:process.env.AUTHOR_LOGIN,fullName:process.env.AUTHOR_FULL_NAME});
  const created=await request('/api/tasks/','POST',{title:'Deployment verification',runId}); assert.equal(created.status,201);
  const task=await created.json(); id=task.id; assert.equal(task.done,false); assert.equal(task.ownerLogin,process.env.AUTHOR_LOGIN); assert.equal(task.runId,runId);
  assert.equal((await request(`/api/tasks/?runId=${runId}`)).status,200);
  const updated=await request(`/api/tasks/${id}/`,'PATCH',{title:'Verified',done:true}); assert.equal(updated.status,200); assert.equal((await updated.json()).done,true);
  assert.equal((await request(`/api/tasks/${id}/`,'DELETE')).status,204);
  assert.equal((await request(`/api/tasks/${id}/`)).status,404); id=undefined;
  const manual=await request('/api/tasks/?runId=manual'); assert.equal(manual.status,200);
  assert.ok((await manual.json()).some(t => t.title===`Итоговая работа 24.10.2026: ${process.env.AUTHOR_LOGIN}`),'Create the personal task manually through the interface');
  console.log('HTTPS/API/manual task verification PASS. Independent SQL CRUD and Moodle submission must also be verified.');
} finally {if(id) await request(`/api/tasks/${id}/`,'DELETE');}
