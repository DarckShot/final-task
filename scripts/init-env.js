import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';

export function generateEnvironment(domain, email) {
  if (!domain || domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)) {
    throw new Error('Provide a DNS domain without protocol, path or port');
  }
  if (!email || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
    throw new Error('Provide an email for certificate notifications');
  }
  const secret = () => randomBytes(32).toString('hex');
  const app = secret(), reviewer = secret();
  const values = {
    AUTHOR_LOGIN: 'sergey_krasn', AUTHOR_FULL_NAME: 'Сергей Краснопольский',
    API_TOKEN: secret(), REVIEWER_API_TOKEN: secret(), POSTGRES_PASSWORD: secret(), APP_DB_PASSWORD: app,
    REVIEWER_DB_PASSWORD: reviewer,
    DATABASE_URL: `postgresql://tasks_app:${app}@db:5432/tasks_db`,
    REVIEWER_DATABASE_URL: `postgresql://tasks_reviewer:${reviewer}@127.0.0.1:5432/tasks_db`,
    DOMAIN: domain.toLowerCase(), ACME_EMAIL: email, PORT: '3000'
  };
  return Object.entries(values).map(([key,value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {values} = parseArgs({options:{domain:{type:'string'},email:{type:'string'},output:{type:'string',default:'.env'}}});
  const content = generateEnvironment(values.domain, values.email);
  await writeFile(values.output,content,{flag:'wx',mode:0o600});
  console.log('Configuration created with independent random secrets and mode 600. Existing files are never overwritten.');
}
