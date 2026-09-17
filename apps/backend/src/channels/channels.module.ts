import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { PrismaModule } from '../prisma/prisma.module';
import { WhatsAppNumbersModule } from '../whatsapp-numbers/whatsapp-numbers.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [PrismaModule, ConfigModule, WhatsAppNumbersModule, AuditModule],
  controllers: [ChannelsController],
  providers: [ChannelsService],
  exports: [ChannelsService],
})
export class ChannelsModule {}
