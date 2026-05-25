import { IsEmail, IsString, MinLength } from 'class-validator';

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

export class UpdatePlanDto {
  name?: string;
  monthlyPrice?: number;
  yearlyPrice?: number;
  isActive?: boolean;
  isPublic?: boolean;
  limMaxAgents?: number;
  limMaxContacts?: number;
  limMessagesPerMonth?: number;
  limAiCreditsPerMonth?: number;
  limMaxChannels?: number;
  limMaxCampaigns?: number;
  limStorageGb?: number;
}
