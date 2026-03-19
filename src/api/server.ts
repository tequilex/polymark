import Fastify, { type FastifyInstance } from 'fastify';

import type { SQLiteDatabase } from '../db/client';
import type { AppHealth } from '../types';
import { registerApiRoutes } from './routes';

export interface BuildServerContext {
  db: SQLiteDatabase;
  getHealth: () => AppHealth;
  enableLogger?: boolean;
  corsOrigin?: string;
}

export function buildServer(context: BuildServerContext): FastifyInstance {
  const app = Fastify({
    logger: context.enableLogger ?? false,
  });

  // Минимальный CORS для будущего React-клиента.
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', context.corsOrigin ?? '*');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (request.method === 'OPTIONS') {
      reply.status(204).send();
    }
  });

  registerApiRoutes(app, {
    db: context.db,
    getHealth: context.getHealth,
  });

  return app;
}
