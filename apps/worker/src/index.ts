import { Redis } from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { CampaignSendWorker } from './processors/campaign-send.processor';
import { AutomationWorker } from './processors/automation.processor';
import { MessageRetryWorker } from './processors/message-retry.processor';
import { SnoozeWorker } from './processors/snooze.processor';
import { AiTrialWorker } from './processors/ai-trial.processor';
import { BillingCronWorker } from './processors/billing-cron.processor';
import { SlaMonitorWorker } from './processors/sla-monitor.processor';
import { InactivityTriggerWorker } from './processors/inactivity-trigger.processor';
import { AnalyticsRollupWorker } from './processors/analytics-rollup.processor';
import { WhatsAppQualitySyncWorker } from './processors/whatsapp-quality-sync.processor';
import { PlatformRollupWorker } from './processors/platform-rollup.processor';
import { KbEmbeddingWorker } from './processors/kb-embedding.processor';

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
  const snoozeWorker = new SnoozeWorker(prisma, connection);
  const aiTrialWorker = new AiTrialWorker(prisma, connection);
  const billingCronWorker = new BillingCronWorker(prisma);
  const slaMonitorWorker = new SlaMonitorWorker(prisma, connection);
  const inactivityWorker = new InactivityTriggerWorker(prisma, connection);
  const analyticsRollupWorker = new AnalyticsRollupWorker(prisma, connection);
  const whatsappQualitySyncWorker = new WhatsAppQualitySyncWorker(prisma, connection);
  const platformRollupWorker = new PlatformRollupWorker(prisma, connection);
  const kbEmbeddingWorker = new KbEmbeddingWorker(prisma, connection);

  campaignWorker.start();
  automationWorker.start();
  retryWorker.start();
  snoozeWorker.start();
  aiTrialWorker.start();
  billingCronWorker.start();
  await slaMonitorWorker.start();
  await inactivityWorker.start();
  await analyticsRollupWorker.start();
  await whatsappQualitySyncWorker.start();
  await platformRollupWorker.start();
  kbEmbeddingWorker.start();

  console.log('All workers started');

  process.on('SIGTERM', async () => {
    console.log('Worker: Graceful shutdown...');
    billingCronWorker.stop();
    await Promise.all([campaignWorker.stop(), automationWorker.stop(), retryWorker.stop(), snoozeWorker.stop(), aiTrialWorker.stop(), slaMonitorWorker.stop(), inactivityWorker.stop(), analyticsRollupWorker.stop(), whatsappQualitySyncWorker.stop(), platformRollupWorker.stop(), kbEmbeddingWorker.stop()]);
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  });
}

bootstrap().catch(console.error);
