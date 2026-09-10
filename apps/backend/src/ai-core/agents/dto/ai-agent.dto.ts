import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateAiAgentDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  personality?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  tone?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  modelKey?: string;

  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(4096)
  maxResponseTokens?: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  systemInstructions?: string;
}

export class UpdateAiAgentDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  personality?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  tone?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  modelKey?: string;

  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(4096)
  maxResponseTokens?: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  systemInstructions?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'PAUSED'])
  status?: 'ACTIVE' | 'PAUSED';
}
