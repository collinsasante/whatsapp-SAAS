import { IsString, IsEnum, IsArray, IsBoolean, IsOptional, IsInt } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AutomationTrigger } from '@whatsapp-platform/shared-types';

export class CreateAutomationRuleDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ enum: AutomationTrigger })
  @IsEnum(AutomationTrigger)
  trigger: AutomationTrigger;

  @ApiProperty({ type: 'array', description: 'Conditions to match' })
  @IsArray()
  conditions: unknown[];

  @ApiProperty({ type: 'array', description: 'Actions to execute' })
  @IsArray()
  actions: unknown[];

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsInt()
  priority?: number;
}

export class UpdateAutomationRuleDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ required: false, type: 'array' })
  @IsOptional()
  @IsArray()
  conditions?: unknown[];

  @ApiProperty({ required: false, type: 'array' })
  @IsOptional()
  @IsArray()
  actions?: unknown[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  priority?: number;
}
