import { ArrayMaxSize, IsArray, IsBoolean, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateWebhookDto {
  @IsString() @MinLength(1) @MaxLength(100)
  name!: string;

  @IsString() @MaxLength(2048)
  url!: string;

  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(64, { each: true })
  events?: string[];

  /** Defaults to true when no `secret` is given. Pass false to create an unsigned webhook (API clients only). Takes precedence over `secret` when true. */
  @IsOptional() @IsBoolean()
  generateSecret?: boolean;

  /** A secret you chose yourself (16 to 256 visible characters). Ignored when generateSecret is true. */
  @IsOptional() @IsString() @MaxLength(256)
  secret?: string;

  @IsOptional() @IsObject()
  headers?: Record<string, string>;
}

export class UpdateWebhookDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100)
  name?: string;

  @IsOptional() @IsString() @MaxLength(2048)
  url?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(64, { each: true })
  events?: string[];

  /** Explicitly replaces the stored secret with one you chose. Omit to leave the secret untouched. */
  @IsOptional() @IsString() @MaxLength(256)
  secret?: string;

  @IsOptional() @IsObject()
  headers?: Record<string, string>;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}
