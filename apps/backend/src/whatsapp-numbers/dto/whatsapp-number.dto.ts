import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

import { StrictBoolean } from '../../common/validation/strict-boolean.decorator';
export class CreateWhatsAppNumberDto {
  @IsString() @IsNotEmpty() label: string;
  @IsString() @IsNotEmpty() phoneNumberId: string;
  @IsString() @IsNotEmpty() wabaId: string;
  @IsString() @IsNotEmpty() accessToken: string;
  @StrictBoolean() @IsOptional() isDefault?: boolean;
}

export class UpdateWhatsAppNumberDto {
  @IsString() @IsOptional() label?: string;
  @IsString() @IsOptional() phoneNumberId?: string;
  @IsString() @IsOptional() wabaId?: string;
  @IsString() @IsOptional() accessToken?: string;
  @StrictBoolean() @IsOptional() isActive?: boolean;
}
