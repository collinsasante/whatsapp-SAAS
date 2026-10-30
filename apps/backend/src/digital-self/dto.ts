import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { OVERRIDE_OPTIONS } from './digital-self.constants';

export class SetLearningPausedDto {
  @ApiProperty() @IsBoolean() paused: boolean;
}

export class SetEnabledDto {
  @ApiProperty() @IsBoolean() enabled: boolean;
}

/** Each field is optional; `null` clears that override. Enumerated values only (no free text reaches a prompt). */
export class SetOverridesDto {
  @ApiProperty({ required: false, enum: OVERRIDE_OPTIONS.length, nullable: true }) @IsOptional() @IsIn(OVERRIDE_OPTIONS.length) length?: (typeof OVERRIDE_OPTIONS.length)[number] | null;
  @ApiProperty({ required: false, enum: OVERRIDE_OPTIONS.emoji, nullable: true }) @IsOptional() @IsIn(OVERRIDE_OPTIONS.emoji) emoji?: (typeof OVERRIDE_OPTIONS.emoji)[number] | null;
  @ApiProperty({ required: false, enum: OVERRIDE_OPTIONS.formality, nullable: true }) @IsOptional() @IsIn(OVERRIDE_OPTIONS.formality) formality?: (typeof OVERRIDE_OPTIONS.formality)[number] | null;
  @ApiProperty({ required: false, enum: OVERRIDE_OPTIONS.warmth, nullable: true }) @IsOptional() @IsIn(OVERRIDE_OPTIONS.warmth) warmth?: (typeof OVERRIDE_OPTIONS.warmth)[number] | null;
}

export class AssignDigitalSelfDto {
  @ApiProperty({ nullable: true, description: 'The Digital Self to use for this conversation, or null to remove the assignment.' })
  // Required: omitting it must not silently remove an assignment. Only an explicit null removes.
  @ValidateIf((_, value) => value !== null) @IsUUID()
  digitalSelfId: string | null;
}
