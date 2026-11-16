import express from 'express';
import helmet from 'helmet';
import {randomUUID, createHash, timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {BadRequest, validUuid, validateBody, validateRunId} from './validation.js';
export function createApp({config, store}) {
  const app = express();
  app.disable('x-powered-by');
  app.enable('strict routing');
  app.set('query parser','simple');
  app.use(helmet());
  app.get('/login/', (_req,res) => res.type('text/plain').send(config.login));
  const expected = createHash('sha256').update(config.token).digest();
  app.use('/api', (req,res,next) => {
    res.set('Cache-Control','no-store');
    const match = /^Bearer ([^\s]+)$/.exec(req.get('authorization') || '');
    if (!match || !timingSafeEqual(expected,createHash('sha256').update(match[1]).digest())) {
      res.set('WWW-Authenticate','Bearer');
      return res.status(401).json({error:'Unauthorized'});
    }
    next();
  });
  app.use('/api',express.json({limit:'16kb',strict:false}));
  app.get('/api/author/', (_req,res) => res.json({login:config.login,fullName:config.fullName}));
  app.post('/api/tasks/', async (req,res) => {
    if (!req.is('application/json')) throw new BadRequest('Expected application/json');
    const data = validateBody(req.body);
    const task = await store.create(randomUUID(),data.title,data.runId);
    res.location(`/api/tasks/${task.id}/`).status(201).json(task);
  });
  app.get('/api/tasks/', async (req,res) => res.json(await store.list(validateRunId(req.query.runId))));
  app.param('id', (_req,_res,next,id) => next(validUuid(id) ? undefined : new BadRequest('Invalid UUID')));
  app.get('/api/tasks/:id/', async (req,res) => {
    const task = await store.get(req.params.id);
    return task ? res.json(task) : res.status(404).json({error:'Task not found'});
  });
  app.patch('/api/tasks/:id/', async (req,res) => {
    if (!req.is('application/json')) throw new BadRequest('Expected application/json');
    const task = await store.update(req.params.id,validateBody(req.body,true));
    return task ? res.json(task) : res.status(404).json({error:'Task not found'});
  });
  app.delete('/api/tasks/:id/', async (req,res) => await store.remove(req.params.id)
    ? res.status(204).end() : res.status(404).json({error:'Task not found'}));
  app.use('/api', (_req,res) => res.status(404).json({error:'Route not found'}));
  app.use(express.static(fileURLToPath(new URL('../public',import.meta.url)),{redirect:false}));
  app.use((_req,res) => res.status(404).type('text/plain').send('Not found'));
  app.use((error,_req,res,_next) => {
    if (error instanceof BadRequest || error.type === 'entity.parse.failed' || error.type === 'entity.too.large' || [400,415].includes(error.status)) {
      return res.status(400).json({error:error instanceof BadRequest ? error.message : 'Invalid JSON body'});
    }
    console.error('Request failed:',error.code || error.name);
    return res.status(503).json({error:'Database unavailable'});
  });
  return app;
}
