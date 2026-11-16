import {readConfig} from './config.js';
import {createPool,taskStore} from './db.js';
import {createApp} from './app.js';
const config = readConfig();
const pool = createPool(config.databaseUrl);
const server = createApp({config,store:taskStore(pool,config.login)}).listen(config.port,'0.0.0.0',() => console.log(`Listening on port ${config.port}`));
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  const timer = setTimeout(() => process.exit(1),10000).unref();
  server.close(async () => {await pool.end(); clearTimeout(timer); process.exit(0);});
}
process.on('SIGTERM',shutdown);
process.on('SIGINT',shutdown);
