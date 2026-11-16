import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// The SQL pool must authenticate as the restricted reviewer, not the app/owner.
export async function verifyDatabase({origin,token,login,pool}) {
  const runId=`verify_${randomUUID()}`;
  const sqlId=randomUUID();
  let apiId;
  const rows = async id => (await pool.query('SELECT * FROM public.tasks WHERE id=$1 AND run_id=$2',[id,runId])).rows;
  async function request(path,method='GET',body) {
    const response=await fetch(new URL(path,origin),{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000),redirect:'error'});
    const text=await response.text();
    if (text) assert.match(response.headers.get('content-type'),/^application\/json/);
    return {status:response.status,body:text?JSON.parse(text):undefined};
  }
  try {
    const {rows:[role]}=await pool.query('SELECT current_user AS name, rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname=current_user');
    assert.equal(role.name,'tasks_reviewer','Connect as tasks_reviewer, never as the DB owner');
    assert.equal(role.rolsuper,false); assert.equal(role.rolcreaterole,false); assert.equal(role.rolcreatedb,false);
    const created=await request('/api/tasks/','POST',{title:'API → SQL',runId});
    assert.equal(created.status,201); apiId=created.body.id;
    assert.equal(created.body.ownerLogin,login); assert.equal(created.body.done,false);
    assert.equal((await rows(apiId))[0].title,'API → SQL');
    await pool.query('UPDATE public.tasks SET title=$1,done=true WHERE id=$2 AND run_id=$3',['SQL → API',apiId,runId]);
    const changed=await request(`/api/tasks/${apiId}/`); assert.equal(changed.status,200);
    assert.equal(changed.body.title,'SQL → API'); assert.equal(changed.body.done,true);
    const patched=await request(`/api/tasks/${apiId}/`,'PATCH',{title:'API PATCH → SQL',done:false});
    assert.equal(patched.status,200);
    const [stored]=await rows(apiId); assert.equal(stored.title,'API PATCH → SQL'); assert.equal(stored.done,false);
    await pool.query('INSERT INTO public.tasks(id,owner_login,title,run_id) VALUES($1,$2,$3,$4)',[sqlId,login,'SQL INSERT → API',runId]);
    const listed=await request(`/api/tasks/?runId=${runId}`); assert.equal(listed.status,200);
    assert.ok(listed.body.some(task => task.id===sqlId));
    await pool.query('DELETE FROM public.tasks WHERE id=$1 AND run_id=$2',[sqlId,runId]);
    assert.equal((await request(`/api/tasks/${sqlId}/`)).status,404);
    const deleted=await request(`/api/tasks/${apiId}/`,'DELETE'); assert.equal(deleted.status,204); assert.equal(deleted.body,undefined);
    assert.equal((await rows(apiId)).length,0);
    return {status:'PASS',checks:['API create/update/delete → SQL','SQL insert/update/delete → API','restricted reviewer login']};
  } finally {
    // Only IDs created by this invocation, within its unique runId.
    await pool.query('DELETE FROM public.tasks WHERE run_id=$1 AND id=ANY($2::uuid[])',[runId,[sqlId,...(apiId?[apiId]:[])]]);
  }
}
