import { IsString, IsEnum, IsArray, IsOptional } from 'class-validator';
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
  @IsArray()
  components: unknown[];
}

export class UpdateTemplateDto {
  @ApiProperty({ required: false, type: 'array' })
  @IsOptional()
  @IsArray()
  components?: unknown[];
}
