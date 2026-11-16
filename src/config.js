export function readConfig(env = process.env) {
  for (const key of ['AUTHOR_LOGIN', 'AUTHOR_FULL_NAME', 'API_TOKEN', 'DATABASE_URL']) {
    if (!env[key]?.trim()) throw new Error(`Required environment variable: ${key}`);
  }
  if (env.API_TOKEN.length < 32) throw new Error('API_TOKEN must contain at least 32 characters');
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  return {login: env.AUTHOR_LOGIN.trim(), fullName: env.AUTHOR_FULL_NAME.trim(), token: env.API_TOKEN, databaseUrl: env.DATABASE_URL, port};
}
