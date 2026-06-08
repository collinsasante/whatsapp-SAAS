import { IsEmail, IsString, MinLength, IsOptional, IsNumber, IsBoolean, IsArray } from 'class-validator';

export class AdminSetupDto {
  @IsString()
  setupSecret: string;

  @IsEmail()
  email: string;

  @IsString()
  name: string;

  @IsString()
  @MinLength(8)
  password: string;
}

export class AdminLoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}

export class CreatePlanDto {
  @IsString()  slug: string;
  @IsString()  name: string;
  @IsOptional() @IsString()  description?: string;
  @IsNumber()  monthlyPrice: number;
  @IsNumber()  yearlyPrice: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() isPublic?: boolean;
  @IsOptional() @IsNumber()  trialDays?: number;
  @IsOptional() @IsNumber()  limMaxAgents?: number;
  @IsOptional() @IsNumber()  limMaxChannels?: number;
  @IsOptional() @IsNumber()  limMaxContacts?: number;
  @IsOptional() @IsNumber()  limMessagesPerMonth?: number;
  @IsOptional() @IsNumber()  limAiCreditsPerMonth?: number;
  @IsOptional() @IsNumber()  limMaxChannels2?: number;
  @IsOptional() @IsNumber()  limMaxCampaigns?: number;
  @IsOptional() @IsNumber()  limStorageGb?: number;
  @IsOptional() @IsNumber()  limMaxTemplates?: number;
  @IsOptional() @IsArray()   features?: string[];
  @IsOptional() @IsNumber()  sortOrder?: number;
}

export class UpdateWorkspaceDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() billingEmail?: string;
}

export class UpdatePlanDto {
  @IsOptional() @IsString()  name?: string;
  @IsOptional() @IsNumber()  monthlyPrice?: number;
  @IsOptional() @IsNumber()  yearlyPrice?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() isPublic?: boolean;
  @IsOptional() @IsNumber()  limMaxAgents?: number;
  @IsOptional() @IsNumber()  limMaxContacts?: number;
  @IsOptional() @IsNumber()  limMessagesPerMonth?: number;
  @IsOptional() @IsNumber()  limAiCreditsPerMonth?: number;
  @IsOptional() @IsNumber()  limMaxChannels?: number;
  @IsOptional() @IsNumber()  limMaxCampaigns?: number;
  @IsOptional() @IsNumber()  limStorageGb?: number;
  @IsOptional() @IsNumber()  limMaxTemplates?: number;
  @IsOptional() @IsArray()   features?: string[];
}
