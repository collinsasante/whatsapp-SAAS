import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const TENANT_ID = 'a98c5ff8-20ba-4d1f-9378-8a1371a288eb';

  let tenant = await prisma.tenant.findUnique({ where: { id: TENANT_ID } });
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        id: TENANT_ID,
        name: "Pakkmax",
        phoneNumberId: '1095571453639433',
        wabaId: '2446646179109530',
        accessToken: 'EAAihD8pZBPFwBRswhOkDW1ZBawg1SsdYWDK0AAaQXgZBccyTCT9GMtkY0vDWl7kkkM9gjlWc2NZA7NlZAVHoKrq9izNb7WgZBxJq0sSaKBOgJE4HDRPnXixaP8xFULs1WGuRR8k3bAU8jdQF3C7BCXhVQLuZBuqgggxoaZAGg3xbxfqMTdV3Thk0fqgZA4hfJPlMdPgZDZD',
        webhookVerifyToken: '2b71a5a4-686a-44cb-83fa-74c9d55ac00c',
        plan: 'free',
        isActive: true,
        onboardingCompleted: true,
        onboardingStep: 2,
      },
    });
    console.log("✓ Tenant created: Pakkmax");
  } else {
    console.log("✓ Tenant already exists: Pakkmax");
  }

  const users = [
    {
      id: '8c738d5f-ab75-43be-b27b-34526bc5c712',
      email: 'debarongh@gmail.com',
      name: 'Benard Addo',
      role: 'ADMIN',
      passwordHash: '$2b$12$Xj5vuq6bTwXXGYizZGpxNu2KroP4GtAj99azWEN/qsV4rGvwHT/6.',
      emailVerified: true,
    },
    {
      id: '3e6c4595-1c84-4b7a-8dbe-24992efdc86d',
      email: 'mr.asantee@gmail.com',
      name: 'Collins Asante',
      role: 'AGENT',
      passwordHash: '$2b$12$BxyCYg59w8zJDxtd7mPJ6ucXAjSK.Kzv51dP.WzSZ8wmoRdy6l45O',
      emailVerified: true,
    },
    {
      id: '7c06946b-4c0c-444c-9fe4-84f935394eb3',
      email: 'kwameforex6@gmail.com',
      name: 'James',
      role: 'AGENT',
      passwordHash: '$2b$12$GMtURqvvYZN5qKkmF8gN/OvJCDunmLEaFOAAWe/JaIZoUomYhRfz2',
      emailVerified: false,
    },
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
          passwordHash: u.passwordHash,
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
      slug: 'starter',
      name: 'Starter',
      description: 'Everything you need to get started with WhatsApp',
      monthlyPrice: 240,
      yearlyPrice: 2400,
      currency: 'GHS',
      trialDays: 0,
      limMaxAgents: 3,
      limMaxChannels: 1,
      limMaxContacts: 5000,
      limMaxTemplates: 10,
      limMessagesPerMonth: 5000,
      limMaxCampaigns: 0,
      limAiCreditsPerMonth: 0,
      limStorageGb: 5,
      features: ['1 WhatsApp Channel', '5,000 Contacts', '5,000 Messages/month', '3 Agents', '10 Templates', 'Automation'],
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
