import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';

// MAJOR.MINOR.PATCH with an optional -prerelease tag (e.g. 1.3.0-beta.1) --
// build metadata (+build) is deliberately not supported, this app has no use
// for it and it would just be another way to enter a malformed version.
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

export class ChangelogDto {
  @IsOptional() @IsArray() @IsString({ each: true }) features?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) improvements?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) fixes?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) breaking?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) security?: string[];
}

export class CreateReleaseDto {
  @IsString() @Matches(SEMVER_PATTERN, { message: 'version must be valid SemVer, e.g. 1.2.0 or 1.3.0-beta.1' })
  version!: string;

  @IsOptional() @IsString() channel?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() changelog?: ChangelogDto;
  @IsOptional() @IsBoolean() isLatest?: boolean;
}

export class UpdateReleaseDto {
  @IsOptional() @IsString() channel?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() changelog?: ChangelogDto;
  @IsOptional() @IsBoolean() isLatest?: boolean;
}

export class LogDeploymentDto {
  @IsString() @Matches(SEMVER_PATTERN, { message: 'version must be valid SemVer' })
  version!: string;

  @IsOptional() @IsString() commitHash?: string;
  @IsOptional() @IsString() branch?: string;
  @IsOptional() @IsString() environment?: string;
  @IsOptional() @IsString() deployedBy?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsInt() @Min(0) buildDuration?: number;
}
