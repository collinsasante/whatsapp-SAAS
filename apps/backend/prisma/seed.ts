import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const DEV_EMAIL    = 'mr.asantee@gmail.com';
  const DEV_PASSWORD = 'Collinsasante1$';
  const DEV_NAME     = 'Collins Asante';

  let tenant = await prisma.tenant.findFirst({ where: { name: 'Dev Workspace' } });
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name: 'Dev Workspace',
        webhookVerifyToken: 'dev-verify-token',
        isActive: true,
        onboardingCompleted: true,
      },
    });
  }

  const existing = await prisma.user.findFirst({ where: { email: DEV_EMAIL } });
  if (!existing) {
    const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);
    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: DEV_EMAIL,
        passwordHash,
        name: DEV_NAME,
        role: 'ADMIN',
        emailVerified: true,
        isActive: true,
      },
    });
    console.log(`✓ Dev user created: ${DEV_EMAIL} / ${DEV_PASSWORD}`);
  } else {
    console.log(`✓ Dev user already exists: ${DEV_EMAIL}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
