import { Controller, Post, Get, Body, Headers, HttpCode, HttpStatus, Param, Redirect, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { PublicService } from './public.service';
import { IsString, IsOptional, IsObject } from 'class-validator';
import { Request } from 'express';

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

  @IsOptional()
  @IsObject()
  urlVariables?: Record<string, string>;
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
    @Req() req: Request,
  ) {
    return this.publicService.sendTemplateMessage(
      apiKey,
      dto.to,
      dto.templateName,
      dto.language,
      dto.variables,
      dto.urlVariables,
      req.ip,
    );
  }

  @Get('c/:code')
  @Redirect()
  @ApiOperation({ summary: 'Campaign link click tracker — logs the click and redirects to destination' })
  async trackClick(@Param('code') code: string, @Req() req: Request) {
    const url = await this.publicService.recordClick(code, req.ip, req.headers['user-agent']);
    return { url: url ?? 'https://verzchat.com', statusCode: 302 };
  }
}
