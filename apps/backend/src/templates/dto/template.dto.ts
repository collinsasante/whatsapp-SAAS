import { IsString, IsEnum, IsArray, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { TemplateCategory } from '@whatsapp-platform/shared-types';

export class CreateTemplateDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ default: 'en' })
  @IsString()
  language: string;

  @ApiProperty({ enum: TemplateCategory })
  @IsEnum(TemplateCategory)
  category: TemplateCategory;

  @ApiProperty({ type: 'array', description: 'Template components (HEADER, BODY, FOOTER, BUTTONS)' })
  @Transform(({ value }) => value)
  @IsArray()
  components: unknown[];
}

export class UpdateTemplateDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiProperty({ required: false, enum: TemplateCategory })
  @IsOptional()
  @IsEnum(TemplateCategory)
  category?: TemplateCategory;

  @ApiProperty({ required: false, type: 'array' })
  @IsOptional()
  @Transform(({ value }) => value)
  @IsArray()
  components?: unknown[];
}
