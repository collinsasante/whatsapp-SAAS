import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WhatsAppWebController } from './whatsapp-web.controller';
import { WhatsAppWebInternalController } from './whatsapp-web-internal.controller';
import { WhatsAppWebService } from './whatsapp-web.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [PrismaModule, ConfigModule, AuditModule, forwardRef(() => MessagesModule)],
  controllers: [WhatsAppWebController, WhatsAppWebInternalController],
  providers: [WhatsAppWebService],
  exports: [WhatsAppWebService],
})
export class WhatsAppWebModule {}
