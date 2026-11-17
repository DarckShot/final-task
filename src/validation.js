export class BadRequest extends Error {}
export const validUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function validateRunId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new BadRequest('Invalid runId');
  return value;
}
export function validateBody(body, patch = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequest('Expected JSON object');
  const allowed = patch ? ['title','done'] : ['title','runId'];
  const keys = Object.keys(body);
  if (!keys.length || keys.some(key => !allowed.includes(key))) throw new BadRequest('Unexpected or missing fields');
  const result = {};
  if (!patch || Object.hasOwn(body,'title')) {
    if (typeof body.title !== 'string') throw new BadRequest('title must be a string');
    result.title = body.title.trim();
    if ([...result.title].length < 1 || [...result.title].length > 200) throw new BadRequest('title must contain 1–200 characters');
    if (/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(result.title)) throw new BadRequest('Invalid title characters');
  }
  if (!patch) result.runId = validateRunId(body.runId);
  if (Object.hasOwn(body,'done')) {
    if (typeof body.done !== 'boolean') throw new BadRequest('done must be boolean');
    result.done = body.done;
  }
  return result;
}
