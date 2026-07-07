import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../../src/app.module';
import { JwtPayload } from '@whatsapp-platform/shared-types';

export async function createTestingApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
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
