import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';
import { WhatsAppWebService } from './whatsapp-web.service';

// Receives events from apps/whatsapp-web (the Baileys session-manager
// service): QR codes ready to display, connection status changes, and
// inbound messages. @Public() bypasses JwtAuthGuard (there is no logged-in
// user here -- the caller is another one of our own containers), but
// InternalApiKeyGuard still requires the shared secret header. This
// endpoint is never reachable from outside the internal Docker network (no
// nginx route to it) regardless.
@Controller('internal/whatsapp-web')
export class WhatsAppWebInternalController {
  constructor(private readonly whatsAppWebService: WhatsAppWebService) {}

  @Post('events')
  @Public()
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  async receiveEvent(@Body() body: Record<string, unknown>) {
    await this.whatsAppWebService.handleInternalEvent(body as never);
    return { ok: true };
  }
}
