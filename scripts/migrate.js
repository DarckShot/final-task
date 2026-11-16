import {readFile} from 'node:fs/promises';
import {createPool} from '../src/db.js';
const url = process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL;
if (!url) throw new Error('Set ADMIN_DATABASE_URL or DATABASE_URL');
const pool = createPool(url);
try {
  await pool.query(await readFile(new URL('../db/001_tasks.sql',import.meta.url),'utf8'));
  console.log('Schema initialized');
} finally {await pool.end();}
