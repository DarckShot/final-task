import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateBody,validateRunId,validUuid} from '../src/validation.js';
import {readConfig} from '../src/config.js';
test('title: trim, Unicode code points and boundaries',() => {
  assert.equal(validateBody({title:'  дело  ',runId:'manual'}).title,'дело');
  assert.equal([...validateBody({title:'😀'.repeat(200),runId:'m'}).title].length,200);
  for (const title of ['', ' \n ', 'a'.repeat(201),null,42,{},true]) assert.throws(() => validateBody({title,runId:'m'}));
});
test('POST fields and JSON objects are strictly validated',() => {
  for (const body of [null,[],1,'x',true,{}, {title:'x'}, {runId:'x'}, {title:'x',runId:'x',done:false}, {title:'x',runId:'x',ownerLogin:'other'}, {title:'x',runId:'x',id:'fake'}, {title:'x',runId:'x',createdAt:'now'}, {title:'x',runId:'x',__proto__:null,extra:1}]) assert.throws(() => validateBody(body));
});
test('PATCH accepts only a nonempty title/done subset',() => {
  for (const body of [{done:false},{done:true},{title:'x'},{title:'x',done:false}]) assert.deepEqual(validateBody(body,true),body);
  for (const body of [{},[],null,{done:'false'},{done:0},{done:null},{title:null},{runId:'x'},{title:'x',extra:1}]) assert.throws(() => validateBody(body,true));
});
test('runId alphabet, type and 1–64 boundary',() => {
  for (const value of ['a','A09_-','a'.repeat(64)]) assert.equal(validateRunId(value),value);
  for (const value of [undefined,null,[],{},1,'','a'.repeat(65),'x y','x/y','кириллица','a\n']) assert.throws(() => validateRunId(value));
});
test('UUID syntax and startup configuration',() => {
  assert.ok(validUuid('12345678-1234-1234-1234-123456789abc'));
  assert.ok(!validUuid('no'));
  assert.throws(() => readConfig({}));
  assert.throws(() => readConfig({AUTHOR_LOGIN:'x',AUTHOR_FULL_NAME:'x',API_TOKEN:'short',DATABASE_URL:'x'}));
});
test('title rejects NUL and malformed Unicode before reaching PostgreSQL',()=>{
  for(const title of ['a\u0000b','\ud800','\udc00']) {
    assert.throws(()=>validateBody({title,runId:'manual'}));
    assert.throws(()=>validateBody({title},true));
  }
});
test('startup rejects unusable Bearer tokens and non-PostgreSQL URLs without leaking secrets',()=>{
  const env={AUTHOR_LOGIN:'author',AUTHOR_FULL_NAME:'Test author',API_TOKEN:'a'.repeat(32),REVIEWER_API_TOKEN:'b'.repeat(32),DATABASE_URL:'postgresql://user:secret@localhost/tasks'};
  assert.equal(readConfig(env).port,3000);
  for(const token of ['a'.repeat(32)+' ','a'.repeat(32)+'\n','я'.repeat(32)]) assert.throws(()=>readConfig({...env,API_TOKEN:token}));
  for(const token of ['short','b'.repeat(32)+' ','я'.repeat(32),env.API_TOKEN]) assert.throws(()=>readConfig({...env,REVIEWER_API_TOKEN:token}));
  for(const databaseUrl of ['garbage-secret','https://user:secret@example.org/tasks']) {
    assert.throws(()=>readConfig({...env,DATABASE_URL:databaseUrl}),error=>!error.message.includes('secret'));
  }
});
