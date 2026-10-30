import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformAdminGuard } from '../platform-admin/platform-admin.guard';
import { ReleaseModule } from './release.module';

// The guard is provided locally in this module (see release.module.ts). If it gains a dependency the module cannot
// resolve, the app fails at start-up, which no unit test of the guard itself would catch.
describe('ReleaseModule wiring', () => {
  it('can build PlatformAdminGuard with its dependencies', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), PrismaModule, ReleaseModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ platformAdmin: { findUnique: jest.fn() } })
      .compile();

    expect(moduleRef.get(PlatformAdminGuard, { strict: false })).toBeInstanceOf(PlatformAdminGuard);
    await moduleRef.close();
  });
});
