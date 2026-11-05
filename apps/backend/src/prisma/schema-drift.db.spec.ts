/**
 * Schema drift guard. `prisma migrate diff` from a database built ONLY from the tracked migrations to schema.prisma proposes 35 statements today
 * (mostly DROPs of legacy objects that hold data in production or staging, so they are deliberately not applied). They are frozen in
 * prisma/schema-drift-baseline.json with the reason for each. This test fails when the proposal changes in either direction:
 *   - a NEW statement means someone changed schema.prisma or a migration without the other (the original cause of the drift);
 *   - a baseline statement that no longer appears means the drift was fixed, so remove it from the baseline.
 * Skipped unless SCHEMA_DRIFT_TEST_DATABASE_URL names a throwaway database that `prisma migrate deploy` has already fully migrated.
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import * as path from 'path';

const url = process.env['SCHEMA_DRIFT_TEST_DATABASE_URL'];
if (url && !/(test|scratch|tmp)/i.test(new URL(url).pathname)) throw new Error('SCHEMA_DRIFT_TEST_DATABASE_URL must name a throwaway database.');
const describeDb = url ? describe : describe.skip;

const root = path.resolve(__dirname, '../..');
const normalise = (sql: string): string[] =>
  sql.split(/\n(?=-- [A-Z][A-Za-z]+\n)/).map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);

describeDb('schema.prisma versus the tracked migrations', () => {
  const baseline = JSON.parse(readFileSync(path.join(root, 'prisma/schema-drift-baseline.json'), 'utf8')) as { statements: Array<{ statement: string; class: string; note: string }> };

  it('proposes exactly the frozen statements: no new drift, and nothing silently fixed', () => {
    const out = execFileSync(path.join(root, 'node_modules/.bin/prisma'), ['migrate', 'diff', '--from-url', url as string, '--to-schema-datamodel', path.join(root, 'prisma/schema.prisma'), '--script'], { encoding: 'utf8', timeout: 120_000 });
    const actual = new Set(normalise(out));
    const frozen = new Set(baseline.statements.map((s) => s.statement));
    const added = [...actual].filter((s) => !frozen.has(s));
    const fixed = [...frozen].filter((s) => !actual.has(s));
    expect({ newDrift: added, fixedSoRemoveFromBaseline: fixed }).toEqual({ newDrift: [], fixedSoRemoveFromBaseline: [] });
  }, 150_000);

  it('every frozen statement has a class and a reason', () => {
    for (const s of baseline.statements) {
      expect(s.class).toMatch(/^[A-Z_]+$/);
      expect(s.class).not.toBe('OTHER');
      expect(s.note.length).toBeGreaterThan(20);
    }
  });
});
