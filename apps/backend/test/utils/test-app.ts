import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../../src/app.module';
import { JwtPayload } from '@whatsapp-platform/shared-types';

/** `validation: true` installs the same global ValidationPipe as src/main.ts, so DTO rules are exercised. */
/** `configure` can replace providers (for example an HTTP client for an external service) before the app is built. */
export async function createTestingApp(opts: { validation?: boolean; configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder } = {}): Promise<INestApplication> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  const moduleRef = await (opts.configure ? opts.configure(builder) : builder).compile();
  // rawBody matches src/main.ts: webhook signatures are computed over the exact bytes Meta sent.
  const app = moduleRef.createNestApplication({ rawBody: true });
  if (opts.validation) {
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true },
    }));
  }
  await app.init();
  // One persistent listening server for the whole suite. Left to supertest, every request binds a fresh ephemeral port, and Node's keep-alive agent can hand a
  // stale socket from a server that just closed to the next request on the recycled port ("Parse Error: Expected HTTP/..."), roughly once in forty runs.
  await app.listen(0, '127.0.0.1');
  return app;
}

/**
 * Signs a real JWT the same way the app's own JwtStrategy expects to verify
 * one (@whatsapp-platform/shared-types JwtPayload, HS256 with JWT_SECRET).
 * The strategy re-validates `sub`/`tenantId` against the DB on every request,
 * so the caller must seed a real matching User + Tenant first (see
 * test-db.ts) -- this only produces a syntactically/cryptographically valid
 * token, not a bypass of the authorization checks.
 */
export function signTestToken(app: INestApplication, payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  const jwtService = app.get(JwtService);
  return jwtService.sign(payload, { secret: process.env.JWT_SECRET ?? 'changeme' });
}
