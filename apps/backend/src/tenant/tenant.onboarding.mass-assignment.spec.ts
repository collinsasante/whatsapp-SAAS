import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { UserRole } from '@whatsapp-platform/shared-types';
import { TenantController } from './tenant.controller';
import { UpdateOnboardingDto } from './dto/update-onboarding.dto';

/** The same pipe main.ts installs. */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } });
const run = (body: unknown) => pipe.transform(body, { type: 'body', metatype: UpdateOnboardingDto });

describe('PATCH /tenant/onboarding mass assignment', () => {
  it.each([{ plan: 'enterprise' }, { aiCredits: 99999 }, { id: 'other-tenant' }, { onboardingStep: 9 }, { status: 'ACTIVE' }, { takeRatePct: 0 }])('rejects the protected field %j', async (body) => {
    await expect(run(body)).rejects.toThrow();
  });

  it('accepts exactly what the onboarding screen sends', async () => {
    await expect(run({ step: 2, phoneNumberId: '1', wabaId: '2', accessToken: 't', businessName: 'x', businessCategory: 'c', businessDescription: 'd', businessAddress: 'a', businessWebsite: 'w', businessEmail: 'e@x.test' })).resolves.toBeDefined();
    await expect(run({ completed: true, step: 2 })).resolves.toBeDefined();
  });

  it('is limited to workspace admins, because it can set the WhatsApp credentials', () => {
    expect(Reflect.getMetadata(ROLES_KEY, TenantController.prototype.updateOnboarding)).toEqual([UserRole.ADMIN]);
  });
});
