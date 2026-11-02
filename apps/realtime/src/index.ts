import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { Redis } from 'ioredis';
import { SocketGateway } from './gateway';
import { createRequireInternalSecret } from './internal-auth';

const PORT = parseInt(process.env['PORT'] ?? '3002', 10);
const REDIS_HOST = process.env['REDIS_HOST'] ?? 'localhost';
const REDIS_PORT = parseInt(process.env['REDIS_PORT'] ?? '6379', 10);
const REDIS_PASSWORD = process.env['REDIS_PASSWORD'];
const FRONTEND_URL = process.env['FRONTEND_URL'] ?? 'http://localhost:3000';
const BACKEND_URL = process.env['BACKEND_URL'] ?? 'http://localhost:3001';
const INTERNAL_SECRET = process.env['INTERNAL_SECRET'];

const app = express();
app.use(express.json());

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: [FRONTEND_URL, BACKEND_URL],
    credentials: true,
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
});

const redisPublisher = new Redis({ host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD, lazyConnect: true });
const redisSubscriber = new Redis({ host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD, lazyConnect: true });

async function bootstrap() {
  await Promise.all([redisPublisher.connect(), redisSubscriber.connect()]);
  console.log('Redis connected');

  const gateway = new SocketGateway(io, redisSubscriber);
  gateway.initialize();

  if (!INTERNAL_SECRET) console.error('INTERNAL_SECRET is not configured -- /internal/emit will refuse every request and no realtime events will be delivered');
  app.post('/internal/emit', createRequireInternalSecret(INTERNAL_SECRET), (req: Request, res: Response) => {
    const { event, payload } = req.body as { event: string; payload: Record<string, unknown> };
    if (typeof event !== 'string' || !event || !payload || typeof payload !== 'object') {
      res.status(400).json({ error: 'event and payload required' });
      return;
    }
    redisPublisher.publish('realtime:events', JSON.stringify({ event, payload }));
    res.json({ ok: true });
  });

  app.get('/health', (_req: Request, res: Response) => res.json({ status: 'ok', connections: io.engine.clientsCount }));

  httpServer.listen(PORT, () => {
    console.log(`Realtime server running on port ${PORT}`);
  });
}

function shutdown(signal: string) {
  console.log(`Realtime: ${signal} received, closing connections`);
  io.close(() => {
    void Promise.allSettled([redisPublisher.quit(), redisSubscriber.quit()]).finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

bootstrap().catch((error: unknown) => {
  console.error('Realtime failed to start:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
