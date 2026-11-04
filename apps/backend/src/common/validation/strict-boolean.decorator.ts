import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean } from 'class-validator';

/**
 * A boolean DTO field that accepts only real booleans (and the strings "true" / "false", which is how booleans arrive in a query string).
 *
 * The app-wide ValidationPipe runs with `enableImplicitConversion`, which turns every value into `Boolean(value)` BEFORE validation. That made the string
 * "false" become `true` (any non-empty string is truthy), and "yes", 1 and {} pass `@IsBoolean()` too: a settings request carrying "false" switched the
 * setting ON. This decorator reads the raw value, so the validator sees what the client actually sent.
 */
export function StrictBoolean(): PropertyDecorator {
  return applyDecorators(
    Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
      const raw = obj[key];
      return raw === 'true' ? true : raw === 'false' ? false : raw;
    }),
    IsBoolean(),
  );
}
