import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InboundService } from './inbound.service';

@ApiTags('Inbound')
@Controller('inbound')
export class InboundController {
  constructor(private readonly inboundService: InboundService) {}

  @Post('email')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resend inbound email webhook' })
  async receiveEmail(@Body() body: Record<string, unknown>) {
    await this.inboundService.handleInboundEmail(body);
    return { ok: true };
  }
}
