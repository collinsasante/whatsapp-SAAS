import express, { NextFunction, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { SessionManager } from './session-manager';

const PORT = parseInt(process.env['PORT'] ?? '3004', 10);
const INTERNAL_API_KEY = process.env['WHATSAPP_WEB_INTERNAL_API_KEY'] ?? '';

const app = express();
app.use(express.json());

const prisma = new PrismaClient();
const sessionManager = new SessionManager(prisma);

// Internal service-to-service auth only -- this service is never exposed
// through nginx, only reachable from backend/worker on the internal Docker
// network, but a shared-secret header is still cheap defense-in-depth
// against anything else that might land on the same network.
function requireInternalKey(req: Request, res: Response, next: NextFunction): void {
  if (!INTERNAL_API_KEY) {
    // Fails open with a loud warning rather than locking out every request
    // in an environment where the key hasn't been provisioned yet -- matches
    // this codebase's established pattern for optional-until-configured
    // secrets (CredentialsEncryptionService, WhatsApp webhook signatures).
    console.warn('WHATSAPP_WEB_INTERNAL_API_KEY not configured -- internal auth is disabled');
    next();
    return;
  }
  if (req.header('x-internal-api-key') !== INTERNAL_API_KEY) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.use(requireInternalKey);

app.post('/sessions', async (req: Request, res: Response) => {
  const { sessionId, tenantId, channelId } = req.body as { sessionId?: string; tenantId?: string; channelId?: string };
  if (!sessionId || !tenantId || !channelId) {
    res.status(400).json({ error: 'sessionId, tenantId, and channelId are required' });
    return;
  }
  try {
    await sessionManager.connect(sessionId, tenantId, channelId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/sessions/:sessionId/disconnect', async (req: Request, res: Response) => {
  await sessionManager.disconnect(req.params['sessionId']!);
  res.json({ ok: true });
});

app.post('/sessions/:sessionId/logout', async (req: Request, res: Response) => {
  await sessionManager.logout(req.params['sessionId']!);
  res.json({ ok: true });
});

app.get('/sessions/:sessionId/status', (req: Request, res: Response) => {
  res.json({ active: sessionManager.isActive(req.params['sessionId']!) });
});

app.post('/sessions/:sessionId/send-text', async (req: Request, res: Response) => {
  const { toPhone, text } = req.body as { toPhone?: string; text?: string };
  if (!toPhone || !text) {
    res.status(400).json({ error: 'toPhone and text are required' });
    return;
  }
  try {
    const providerMessageId = await sessionManager.sendText(req.params['sessionId']!, toPhone, text);
    res.json({ providerMessageId });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/sessions/:sessionId/send-media', async (req: Request, res: Response) => {
  const { toPhone, mediaUrl, mediaType, caption } = req.body as {
    toPhone?: string; mediaUrl?: string; mediaType?: 'image' | 'video' | 'audio' | 'document'; caption?: string;
  };
  if (!toPhone || !mediaUrl || !mediaType) {
    res.status(400).json({ error: 'toPhone, mediaUrl, and mediaType are required' });
    return;
  }
  try {
    const providerMessageId = await sessionManager.sendMedia(req.params['sessionId']!, toPhone, mediaUrl, mediaType, caption);
    res.json({ providerMessageId });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

async function bootstrap() {
  await sessionManager.restoreConnectedSessions();

  const server = app.listen(PORT, () => {
    console.log(`WhatsApp Web session-manager running on port ${PORT}`);
  });

  // Graceful shutdown: persist every active session's auth state before the
  // process exits, so a redeploy/restart doesn't lose in-memory-only key
  // writes that hadn't hit their debounce yet.
  const shutdown = async () => {
    console.log('Shutting down -- flushing active session auth state');
    await sessionManager.flushAll();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000);
  };
  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT', () => { void shutdown(); });
}

bootstrap().catch((err) => {
  console.error('Failed to start whatsapp-web service', err);
  process.exit(1);
});
