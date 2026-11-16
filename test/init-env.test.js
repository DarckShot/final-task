import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseEnv} from 'node:util';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {generateEnvironment} from '../scripts/init-env.js';

test('generated config has independent random secrets and matching URLs',() => {
  const env=parseEnv(generateEnvironment('tasks.example.org','student@example.org'));
  const secrets=['API_TOKEN','POSTGRES_PASSWORD','APP_DB_PASSWORD','REVIEWER_DB_PASSWORD'].map(key=>env[key]);
  secrets.forEach(value => assert.match(value,/^[0-9a-f]{64}$/));
  assert.equal(new Set(secrets).size,4);
  assert.equal(new URL(env.DATABASE_URL).password,env.APP_DB_PASSWORD);
  assert.equal(new URL(env.REVIEWER_DATABASE_URL).password,env.REVIEWER_DB_PASSWORD);
  assert.equal(new URL(env.DATABASE_URL).username,'tasks_app');
  assert.equal(new URL(env.REVIEWER_DATABASE_URL).username,'tasks_reviewer');
  assert.equal(env.AUTHOR_FULL_NAME,'Краснопольский Сергей Вячеславович');
  assert.notEqual(parseEnv(generateEnvironment('tasks.example.org','student@example.org')).API_TOKEN,env.API_TOKEN);
});
test('configuration rejects malformed domains and emails',() => {
  for (const domain of ['localhost','https://tasks.example.org','tasks.example.org/a','tasks.example.org:443','x\nEVIL=1','x..org','-x.org']) assert.throws(()=>generateEnvironment(domain,'student@example.org'));
  for (const email of ['', 'x', 'a@b', 'x@example.org\nEVIL=1','x$VAR@example.org']) assert.throws(()=>generateEnvironment('tasks.example.org',email));
});
test('CLI creates a private file and refuses to overwrite existing credentials',async () => {
  const dir=await mkdtemp(join(tmpdir(),'final-task-env-'));
  const file=join(dir,'.env');
  const args=['scripts/init-env.js','--domain','tasks.example.org','--email','student@example.org','--output',file];
  try {
    const first=spawnSync(process.execPath,args,{encoding:'utf8'}); assert.equal(first.status,0,first.stderr);
    const initial=await readFile(file,'utf8');
    assert.equal((await stat(file)).mode & 0o777,0o600);
    assert.ok(!first.stdout.includes(parseEnv(initial).API_TOKEN));
    assert.notEqual(spawnSync(process.execPath,args,{encoding:'utf8'}).status,0);
    assert.equal(await readFile(file,'utf8'),initial);
  } finally {await rm(dir,{recursive:true,force:true});}
});
