import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateWhatsAppNumberDto {
  @IsString() @IsNotEmpty() label: string;
  @IsString() @IsNotEmpty() phoneNumberId: string;
  @IsString() @IsNotEmpty() wabaId: string;
  @IsString() @IsNotEmpty() accessToken: string;
  @IsBoolean() @IsOptional() isDefault?: boolean;
}

export class UpdateWhatsAppNumberDto {
  @IsString() @IsOptional() label?: string;
  @IsString() @IsOptional() phoneNumberId?: string;
  @IsString() @IsOptional() wabaId?: string;
  @IsString() @IsOptional() accessToken?: string;
  @IsBoolean() @IsOptional() isActive?: boolean;
}
