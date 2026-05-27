import { Controller, Post, Body, Headers, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { PublicService } from './public.service';
import { IsString, IsOptional, IsObject } from 'class-validator';

class SendTemplateDto {
  @IsString()
  to: string;

  @IsString()
  templateName: string;

  @IsString()
  language: string;

  @IsOptional()
  @IsObject()
  variables?: Record<string, string>;
}

@ApiTags('Public API')
@Controller()
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Post('send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a WhatsApp template message via API key' })
  @ApiHeader({ name: 'X-Api-Key', description: 'Your VerzChat API key (wap_...)' })
  async send(
    @Headers('x-api-key') apiKey: string,
    @Body() dto: SendTemplateDto,
  ) {
    return this.publicService.sendTemplateMessage(
      apiKey,
      dto.to,
      dto.templateName,
      dto.language,
      dto.variables,
    );
  }
}
