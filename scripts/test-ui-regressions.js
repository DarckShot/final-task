import {chromium,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createPool,taskStore} from '../src/db.js';
import {createApp} from '../src/app.js';

if(!process.env.TEST_DATABASE_URL) throw Error('Dedicated TEST_DATABASE_URL required');
const pool=createPool(process.env.TEST_DATABASE_URL);
await pool.query(await readFile(new URL('../db/001_tasks.sql',import.meta.url),'utf8'));
const config={login:`audit_${randomUUID()}`,fullName:'UI audit author',token:randomUUID(),reviewerToken:randomUUID()};
const server=createApp({config,store:taskStore(pool,config.login)}).listen(0,'127.0.0.1');
await once(server,'listening');
const origin=`http://127.0.0.1:${server.address().port}`;
await mkdir(new URL('../test-results/ui-audit/',import.meta.url),{recursive:true});
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome',headless:true});
const results=[];
const count=async()=>Number((await pool.query('SELECT count(*) FROM tasks WHERE owner_login=$1',[config.login])).rows[0].count);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function login(page) {
  await page.locator('#token').fill(config.token); await page.locator('#token').press('Enter');
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#title')).toBeFocused();
}
async function add(page,title) {
  await page.locator('#title').fill(title);await page.locator('#title').press('Enter');
  await expect(page.locator('.task-title').filter({hasText:title.trim()})).toHaveCount(1);
  await expect(page.locator('#title')).toHaveValue('');
}
async function check(name,fn) {
  await pool.query('DELETE FROM tasks WHERE owner_login=$1',[config.login]);
  const context=await browser.newContext({viewport:{width:1440,height:1100}});
  const page=await context.newPage();page.setDefaultTimeout(4000);
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.goto(origin);await fn(page);expect(errors).toEqual([]);
    results.push({name,status:'PASS'});console.log(`PASS: ${name}`);
  } catch(error) {
    results.push({name,status:'FAIL',error:error.message});console.log(`FAIL: ${name}: ${error.message.split('\n').filter(Boolean).slice(0,2).join(' ')}`);
    await page.screenshot({path:new URL(`../test-results/ui-audit/failure-${results.length}.png`,import.meta.url).pathname,fullPage:true}).catch(()=>{});
  } finally {await context.close();}
}
try {
  await check('Keyboard login, empty state and author identity',async page=>{
    await page.keyboard.press('Tab');await expect(page.locator('.skip')).toBeFocused();
    await page.locator('#token').fill('invalid');await page.locator('#token').press('Enter');
    await expect(page.getByRole('status')).toContainText('Неверный токен');
    await login(page);await expect(page.locator('#empty')).toBeVisible();
    await expect(page.locator('#author')).toHaveText(`${config.fullName} · ${config.login}`);
    await page.screenshot({path:new URL('../test-results/ui-audit/desktop.png',import.meta.url).pathname,fullPage:true});
  });
  await check('Title validation, trimming and Unicode boundary',async page=>{
    await login(page);
    for(const value of ['   ','a'.repeat(201)]) {
      await page.locator('#title').fill(value);await page.locator('#title').press('Enter');
      await expect(page.getByRole('status')).toContainText('от 1 до 200');expect(await count()).toBe(0);
    }
    await add(page,'  С пробелами  ');await expect(page.locator('.task-title')).toHaveText('С пробелами');
    await add(page,'😀'.repeat(200));expect(await count()).toBe(2);
  });
  await check('Edit Cancel and Escape preserve the database',async page=>{
    await login(page);await add(page,'Original');
    await page.getByRole('button',{name:'Изменить: Original',exact:true}).click();
    await page.locator('#edit-title').fill('Not saved');await page.locator('#cancel-edit').click();
    await expect(page.locator('#edit-dialog')).not.toBeVisible();await expect(page.locator('.task-title')).toHaveText('Original');
    await page.getByRole('button',{name:'Изменить: Original',exact:true}).click();
    await page.locator('#edit-title').fill('Not saved again');await page.keyboard.press('Escape');
    await expect(page.locator('#edit-dialog')).not.toBeVisible();
    expect((await pool.query('SELECT title FROM tasks WHERE owner_login=$1',[config.login])).rows[0].title).toBe('Original');
  });
  await check('Inline edit error and successful keyboard save',async page=>{
    await login(page);await add(page,'Original');
    await page.getByRole('button',{name:'Изменить: Original',exact:true}).click();
    await page.locator('#edit-title').fill('   ');await page.locator('#edit-title').press('Enter');
    await expect(page.locator('#edit-error')).toContainText('от 1 до 200');await expect(page.locator('#edit-dialog')).toBeVisible();
    await page.locator('#edit-title').fill('Saved by keyboard');await page.locator('#edit-title').press('Enter');
    await expect(page.locator('.task-title')).toHaveText('Saved by keyboard');
  });
  await check('Keyboard focus remains on visible control after saving',async page=>{
    await login(page);await add(page,'Focus');await page.getByRole('button',{name:'Изменить: Focus',exact:true}).click();
    await page.locator('#edit-title').fill('New focus');await page.locator('#edit-title').press('Enter');
    await expect(page.locator('.task-title')).toHaveText('New focus');await pause(100);
    const active=await page.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.id,visible:!!document.activeElement.getClientRects().length}));
    expect(active.tag,'Saving should not lose keyboard focus to BODY').not.toBe('BODY');expect(active.visible).toBe(true);
  });
  await check('Keyboard focus remains after toggling done',async page=>{
    await login(page);await add(page,'Toggle focus');
    await page.getByRole('checkbox').focus();await page.keyboard.press('Space');
    await expect(page.locator('#count')).toHaveText('Выполнено 1 из 1');await pause(100);
    await expect(page.getByRole('checkbox')).toBeFocused();
  });
  await check('Delete cancellation and confirmed deletion',async page=>{
    await login(page);await add(page,'Delete me');
    page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Удалить: Delete me',exact:true}).click();
    await expect(page.locator('.task-title')).toHaveCount(1);expect(await count()).toBe(1);
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Удалить: Delete me',exact:true}).click();
    await expect(page.locator('#empty')).toBeVisible();expect(await count()).toBe(0);
  });
  await check('Manual button is idempotent and runId isolates groups',async page=>{
    await login(page);
    await page.locator('#personal-task').click();await expect(page.locator('.task-title')).toHaveCount(1);
    await page.locator('#personal-task').click();await expect(page.getByRole('status')).toContainText('Персональное дело');
    await expect(page.locator('#personal-task')).toBeEnabled();expect(await count()).toBe(1);
    await page.locator('#run-id').fill('other');await page.locator('#run-id').press('Enter');await expect(page.locator('#empty')).toBeVisible();
    await add(page,'Other group');expect(await count()).toBe(2);
    await page.locator('#run-id').fill('manual');await page.locator('#run-id').press('Enter');
    await expect(page.locator('.task-title')).toHaveText(`Итоговая работа 24.10.2026: ${config.login}`);
  });
  await check('Reload clears token but retains database tasks',async page=>{
    await login(page);await add(page,'Persistent');await page.reload();
    await expect(page.locator('#login-panel')).toBeVisible();await expect(page.locator('#workspace')).not.toBeVisible();
    expect(await page.evaluate(()=>[localStorage.length,sessionStorage.length])).toEqual([0,0]);
    await login(page);await expect(page.locator('.task-title')).toHaveText('Persistent');
  });
  await check('503 is explained and refresh recovers (simulated response)',async page=>{
    await login(page);await add(page,'Survives error');
    const pattern='**/api/tasks/?runId=manual';
    await page.route(pattern,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Database unavailable'})}));
    await page.locator('#refresh').click();await expect(page.getByRole('status')).toContainText('База данных недоступна');
    await page.unroute(pattern);await page.locator('#refresh').click();await expect(page.getByRole('status')).toContainText('обновлены');
    await expect(page.locator('.task-title')).toHaveText('Survives error');
  });
  await check('Expired token during edit returns to usable login (simulated 401)',async page=>{
    await login(page);await add(page,'Expired');await page.getByRole('button',{name:'Изменить: Expired',exact:true}).click();
    await page.route('**/api/tasks/*/',route=>route.fulfill({status:401,contentType:'application/json',body:'{"error":"Unauthorized"}'}));
    await page.locator('#edit-title').fill('No auth');await page.locator('#edit-title').press('Enter');
    await expect(page.getByRole('status')).toContainText('Неверный токен');
    await expect(page.locator('#edit-dialog')).not.toBeVisible();await expect(page.locator('#token')).toBeFocused();
  });
  await check('Responsive layout with populated list and long title',async page=>{
    await login(page);await add(page,'Очень длинное название '.repeat(9).slice(0,200));
    await expect(page.locator('h1')).toHaveCount(1);
    for(const width of [320,375,768,1440]) {
      await page.setViewportSize({width,height:900});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`No horizontal overflow at ${width}px`).toBe(true);
    }
    await page.setViewportSize({width:375,height:812});
    await page.screenshot({path:new URL('../test-results/ui-audit/mobile.png',import.meta.url).pathname,fullPage:true});
    await page.screenshot({path:new URL('../test-results/ui-audit/mobile-top.png',import.meta.url).pathname});
    await page.locator('#tasks').scrollIntoViewIfNeeded();
    await page.screenshot({path:new URL('../test-results/ui-audit/mobile-list.png',import.meta.url).pathname});
    await page.locator('.task-actions button').first().click();await expect(page.locator('#edit-dialog')).toBeVisible();
    const bounds=await page.locator('#edit-dialog').boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(375);
  });
  await check('SQL changes refresh into UI; XSS remains inert',async page=>{
    await login(page);await add(page,'SQL');
    await pool.query('UPDATE tasks SET title=$1,done=true WHERE owner_login=$2',['<img src=x onerror=alert(1)>',config.login]);
    await page.locator('#refresh').click();await expect(page.locator('.task-title')).toHaveText('<img src=x onerror=alert(1)>');
    await expect(page.locator('#tasks img')).toHaveCount(0);await expect(page.getByRole('checkbox')).toBeChecked();
  });
} finally {
  const report={browser:'Chrome/Chromium',date:new Date().toISOString().slice(0,10),results,passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status==='FAIL').length};
  await writeFile(new URL('../test-results/ui-audit/report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(`SUMMARY: ${report.passed} passed; ${report.failed} failed`);
  await browser.close();await new Promise(resolve=>server.close(resolve));
  await pool.query('DELETE FROM tasks WHERE owner_login=$1',[config.login]);await pool.end();
  process.exitCode=report.failed?1:0;
}
