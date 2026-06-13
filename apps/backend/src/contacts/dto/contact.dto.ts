import { IsString, IsEmail, IsOptional, IsArray, IsObject, IsBoolean, IsDefined } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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
  @IsBoolean()
  isBlocked?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  optedOut?: boolean;
}

export class ImportContactsDto {
  @ApiProperty({ type: [CreateContactDto] })
  @IsDefined()
  @IsArray()
  contacts: CreateContactDto[];
}
