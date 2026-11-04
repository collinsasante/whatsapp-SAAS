import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as fs from 'fs';
import * as path from 'path';
import { StrictBoolean } from './strict-boolean.decorator';
import { IsOptional } from 'class-validator';

class Dto {
  @IsOptional() @StrictBoolean() flag?: boolean;
}

// The same options as src/main.ts, including the implicit conversion that caused the bug.
const parse = async (raw: unknown) => {
  const dto = plainToInstance(Dto, { flag: raw }, { enableImplicitConversion: true });
  return { dto, errors: await validate(dto, { whitelist: true, forbidNonWhitelisted: true }) };
};

describe('StrictBoolean under the app-wide implicit conversion', () => {
  it.each([[true, true], [false, false], ['true', true], ['false', false]])('accepts %p and reads it as %p', async (raw, want) => {
    const { dto, errors } = await parse(raw);
    expect(errors).toHaveLength(0);
    expect(dto.flag).toBe(want);
  });
  it.each(['yes', 'no', 'on', '0', '1', 0, 1, 2, {}, [], [true], 'TRUE', ' false'])('rejects %p instead of coercing it', async (raw) => {
    expect((await parse(raw)).errors.length).toBeGreaterThan(0);
  });
  it('treats an omitted value as absent', async () => {
    const dto = plainToInstance(Dto, {}, { enableImplicitConversion: true });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.flag).toBeUndefined();
  });
});

describe('structural guard: no DTO may use the coercing @IsBoolean() on its own', () => {
  const root = path.resolve(__dirname, '..', '..');
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(p)) : /\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name) ? [p] : [];
  });
  it('every @IsBoolean() is behind StrictBoolean or an explicit raw-value Transform', () => {
    const offenders: string[] = [];
    for (const f of walk(root)) {
      if (f.endsWith('strict-boolean.decorator.ts')) continue;
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (line.includes('@IsBoolean(') && !line.includes('rawValue')) offenders.push(`${path.relative(root, f)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
