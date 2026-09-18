import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// Dev convenience seed only -- never wired into any production/deploy path
// (confirmed: no `prisma.seed` package.json config, not called from any
// Dockerfile CMD, CI workflow, or docker-compose). Credentials below are
// intentionally placeholder/env-driven, not real -- this file previously
// held a real, committed WhatsApp access token and real user emails/password
// hashes, redacted here for secrets hygiene. Rotate any credential that was
// ever committed to this file, since removing it here does not remove it
// from git history.
async function main() {
  const TENANT_ID = 'a98c5ff8-20ba-4d1f-9378-8a1371a288eb';

  let tenant = await prisma.tenant.findUnique({ where: { id: TENANT_ID } });
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        id: TENANT_ID,
        name: 'Dev Workspace',
        phoneNumberId: process.env['SEED_WHATSAPP_PHONE_NUMBER_ID'] ?? 'CHANGE_ME_PHONE_NUMBER_ID',
        wabaId: process.env['SEED_WHATSAPP_WABA_ID'] ?? 'CHANGE_ME_WABA_ID',
        accessToken: process.env['SEED_WHATSAPP_ACCESS_TOKEN'] ?? 'CHANGE_ME_ACCESS_TOKEN',
        webhookVerifyToken: process.env['SEED_WEBHOOK_VERIFY_TOKEN'] ?? 'CHANGE_ME_WEBHOOK_VERIFY_TOKEN',
        plan: 'free',
        isActive: true,
        onboardingCompleted: true,
        onboardingStep: 2,
      },
    });
    console.log('✓ Tenant created: Dev Workspace');
  } else {
    console.log('✓ Tenant already exists: Dev Workspace');
  }

  // A single dev password for every seeded user -- override via env for a
  // local run, never commit a real one.
  const devPassword = process.env['SEED_USER_PASSWORD'] ?? 'CHANGE_ME_DEV_PASSWORD';
  const passwordHash = await bcrypt.hash(devPassword, 12);

  const users = [
    { id: '8c738d5f-ab75-43be-b27b-34526bc5c712', email: 'admin@example.com', name: 'Dev Admin', role: 'ADMIN', emailVerified: true },
    { id: '3e6c4595-1c84-4b7a-8dbe-24992efdc86d', email: 'agent1@example.com', name: 'Dev Agent One', role: 'AGENT', emailVerified: true },
    { id: '7c06946b-4c0c-444c-9fe4-84f935394eb3', email: 'agent2@example.com', name: 'Dev Agent Two', role: 'AGENT', emailVerified: false },
  ];

  for (const u of users) {
    const existing = await prisma.user.findUnique({ where: { id: u.id } });
    if (!existing) {
      await prisma.user.create({
        data: {
          id: u.id,
          tenantId: TENANT_ID,
          email: u.email,
          name: u.name,
          role: u.role as any,
          passwordHash,
          emailVerified: u.emailVerified,
          isActive: true,
        },
      });
      console.log(`✓ User created: ${u.email} (${u.role})`);
    } else {
      console.log(`✓ User already exists: ${u.email}`);
    }
  }
}

async function seedPlans() {
  const plans = [
    {
      slug: 'free',
      name: 'Free',
      description: 'Get started with the basics, no credit card needed',
      monthlyPrice: 0,
      yearlyPrice: 0,
      currency: 'GHS',
      trialDays: 0,
      limMaxAgents: 1,
      limMaxChannels: 1,
      limMaxContacts: -1,
      limMaxTemplates: 0,
      limMessagesPerMonth: -1,
      limMaxCampaigns: 0,
      limAiCreditsPerMonth: 0,
      limStorageGb: 1,
      features: ['1 WhatsApp Channel', 'Unlimited Contacts', 'Unlimited Messages/month', '1 Agent'],
      isActive: true,
      isPublic: true,
      sortOrder: -1,
    },
    {
      slug: 'starter',
      name: 'Starter',
      description: 'Everything you need to get started with WhatsApp',
      monthlyPrice: 16,
      yearlyPrice: 160,
      currency: 'GHS',
      trialDays: 0,
      limMaxAgents: 2,
      limMaxChannels: 1,
      limMaxContacts: -1,
      limMaxTemplates: 3,
      limMessagesPerMonth: -1,
      limMaxCampaigns: 3,
      limAiCreditsPerMonth: 0,
      limStorageGb: 5,
      features: ['1 WhatsApp Channel', 'Unlimited Contacts', 'Unlimited Messages/month', '2 Agents', '3 Templates', '3 Automations'],
      isActive: true,
      isPublic: true,
      sortOrder: 0,
    },
    {
      slug: 'pro',
      name: 'Pro',
      description: 'Everything you need to grow with WhatsApp',
      monthlyPrice: 313,
      yearlyPrice: 3130,
      currency: 'GHS',
      trialDays: 7,
      limMaxAgents: 20,
      limMaxChannels: 5,
      limMaxContacts: 20000,
      limMaxTemplates: -1,
      limMessagesPerMonth: -1,
      limMaxCampaigns: -1,
      limAiCreditsPerMonth: -1,
      limStorageGb: 20,
      features: ['5 WhatsApp Channels', '20,000 Contacts', 'Unlimited Messages', '20 Agents', 'Unlimited Templates', 'Campaigns', 'Automation', 'Verz AI Assistant', 'Knowledge Base', 'Analytics', '7-day Trial'],
      isActive: true,
      isPublic: true,
      sortOrder: 1,
    },
  ];

  for (const plan of plans) {
    await (prisma.plan as any).upsert({
      where: { slug: plan.slug },
      update: { ...plan, features: plan.features as any },
      create: { ...plan, features: plan.features as any },
    });
    console.log(`✓ Plan upserted: ${plan.name}`);
  }
}

main()
  .then(() => seedPlans())
  .catch(console.error)
  .finally(() => prisma.$disconnect());
