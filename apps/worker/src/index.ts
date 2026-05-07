import { Redis } from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { CampaignSendWorker } from './processors/campaign-send.processor';
import { AutomationWorker } from './processors/automation.processor';
import { MessageRetryWorker } from './processors/message-retry.processor';

const REDIS_HOST = process.env['REDIS_HOST'] ?? 'localhost';
const REDIS_PORT = parseInt(process.env['REDIS_PORT'] ?? '6379', 10);
const REDIS_PASSWORD = process.env['REDIS_PASSWORD'];

const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  maxRetriesPerRequest: null,
});

const prisma = new PrismaClient({
  log: process.env['NODE_ENV'] === 'development' ? ['error', 'warn'] : ['error'],
});

async function bootstrap() {
  await prisma.$connect();
  console.log('Worker: Database connected');

  const connection = { host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD };

  const campaignWorker = new CampaignSendWorker(prisma, connection);
  const automationWorker = new AutomationWorker(prisma, connection);
  const retryWorker = new MessageRetryWorker(prisma, connection);

  campaignWorker.start();
  automationWorker.start();
  retryWorker.start();

  console.log('All workers started');

  process.on('SIGTERM', async () => {
    console.log('Worker: Graceful shutdown...');
    await Promise.all([campaignWorker.stop(), automationWorker.stop(), retryWorker.stop()]);
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  });
}

bootstrap().catch(console.error);
