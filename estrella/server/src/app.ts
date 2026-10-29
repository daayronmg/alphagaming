import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { authMiddleware, csrfGuard } from './lib/auth.ts';
import { errorHandler } from './lib/http.ts';
import { authRouter } from './routes/auth.ts';
import { orgRouter } from './routes/org.ts';
import { membersRouter } from './routes/members.ts';
import { libraryRouter } from './routes/library.ts';
import { filesRouter } from './routes/files.ts';
import { scoresRouter } from './routes/scores.ts';
import { annotationsRouter } from './routes/annotations.ts';
import { doubtsRouter } from './routes/doubts.ts';
import { eventsRouter } from './routes/events.ts';
import { liveRouter } from './routes/live.ts';
import { commsRouter } from './routes/comms.ts';
import { academyRouter } from './routes/academy.ts';
import { assistantRouter } from './routes/assistant.ts';
import { statsRouter } from './routes/stats.ts';
import { inventoryRouter } from './routes/inventory.ts';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
    next();
  });
  app.use(express.json({ limit: '4mb' }));
  app.use(cookieParser());
  app.use('/api', authMiddleware, csrfGuard);
  app.get('/api/health', (_req, res) => res.json({ ok: true, app: config.appName, time: Date.now() }));
  app.use('/api/auth', authRouter);
  app.use('/api/org', orgRouter);
  app.use('/api/members', membersRouter);
  app.use('/api/library', libraryRouter);
  app.use('/api/files', filesRouter);
  app.use('/api/scores', scoresRouter);
  app.use('/api/annotations', annotationsRouter);
  app.use('/api/doubts', doubtsRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/live', liveRouter);
  app.use('/api/comms', commsRouter);
  app.use('/api/academy', academyRouter);
  app.use('/api/assistant', assistantRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api/inventory', inventoryRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

  // Interfaz compilada (producción): un solo servidor para API, WebSocket y PWA
  if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
    app.use(express.static(config.webDist, { index: false, maxAge: '1h', setHeaders: (res, p) => {
      if (/sw\.js$|index\.html$|manifest/.test(p)) res.setHeader('Cache-Control', 'no-cache');
      else if (/\/assets\//.test(p)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } }));
    app.get('*', (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(config.webDist, 'index.html')); });
  }
  app.use(errorHandler);
  return app;
}
