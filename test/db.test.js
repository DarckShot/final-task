import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import pg from 'pg';
import {createPool} from '../src/db.js';

test('trusted root certificate option is passed to PostgreSQL TLS',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'final-task-ca-'));
  const file=join(dir,'root.pem');
  await writeFile(file,'test-root-certificate');
  let pool;
  try {
    pool=createPool('postgresql://user:password@localhost/db?sslmode=verify-full',{rootCert:file});
    const client=new pg.Client(pool.options);
    assert.equal(client.connectionParameters.ssl.ca,'test-root-certificate');
    assert.notEqual(client.connectionParameters.ssl.rejectUnauthorized,false);
  } finally {await pool?.end();await rm(dir,{recursive:true,force:true});}
});
test('an explicit certificate in the URL takes precedence over the environment option',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'final-task-ca-'));
  const file=join(dir,'root.pem');await writeFile(file,'explicit-root');
  let pool;
  try {
    const url=new URL('postgresql://user:password@localhost/db?sslmode=verify-full');url.searchParams.set('sslrootcert',file);
    pool=createPool(url.href,{rootCert:'/not-a-real-file'});
    assert.equal(new pg.Client(pool.options).connectionParameters.ssl.ca,'explicit-root');
  } finally {await pool?.end();await rm(dir,{recursive:true,force:true});}
});
