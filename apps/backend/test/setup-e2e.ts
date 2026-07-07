import * as path from 'path';
import { config } from 'dotenv';

// Loaded via jest's `setupFiles` (before the test framework and any test file
// imports run), so DATABASE_URL etc. are in process.env before PrismaClient
// is ever constructed. Falls back silently if .env.test doesn't exist --
// CI can instead set these env vars directly.
config({ path: path.resolve(__dirname, '../.env.test') });

if (!process.env.DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    '[e2e] DATABASE_URL is not set. Create apps/backend/.env.test (see .env.test.example) ' +
    'pointing at a disposable test database, or export DATABASE_URL before running `pnpm test:e2e`.',
  );
}
