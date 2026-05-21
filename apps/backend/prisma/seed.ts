import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const TENANT_ID = 'a98c5ff8-20ba-4d1f-9378-8a1371a288eb';

  let tenant = await prisma.tenant.findUnique({ where: { id: TENANT_ID } });
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        id: TENANT_ID,
        name: "Benard's Workspace",
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
    console.log("✓ Tenant created: Benard's Workspace");
  } else {
    console.log("✓ Tenant already exists: Benard's Workspace");
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

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
