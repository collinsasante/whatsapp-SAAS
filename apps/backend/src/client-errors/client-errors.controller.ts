import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { notify } from '../common/notifier';

interface ClientErrorDto {
  message: string;
  stack?: string;
  url?: string;
  userAgent?: string;
  tenantId?: string;
  userId?: string;
}

@Controller('client-errors')
export class ClientErrorsController {
  @Public()
  @Post()
  @HttpCode(204)
  async report(@Body() body: ClientErrorDto) {
    if (!body?.message) return;
    await notify({
      source: 'frontend',
      url: body.url,
      message: body.message,
      stack: body.stack,
      tenantId: body.tenantId,
      extra: { userAgent: body.userAgent, userId: body.userId },
    });
  }
}
