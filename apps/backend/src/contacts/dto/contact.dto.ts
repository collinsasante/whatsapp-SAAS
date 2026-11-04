import { IsString, IsEmail, IsOptional, IsArray, IsObject, IsDefined } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { StrictBoolean } from '../../common/validation/strict-boolean.decorator';
export class CreateContactDto {
  @ApiProperty({ example: '+14155552671' })
  @IsString()
  phone: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  labels?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  customFields?: Record<string, string>;
}

export class UpdateContactDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  labels?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  customFields?: Record<string, string>;

  @ApiProperty({ required: false })
  @IsOptional()
  @StrictBoolean()
  isBlocked?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @StrictBoolean()
  optedOut?: boolean;
}

export class ImportContactsDto {
  @ApiProperty({ type: [CreateContactDto] })
  @IsDefined()
  @IsArray()
  contacts: CreateContactDto[];
}
