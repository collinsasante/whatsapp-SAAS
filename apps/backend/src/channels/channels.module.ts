import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { PrismaModule } from '../prisma/prisma.module';
import { WhatsAppNumbersModule } from '../whatsapp-numbers/whatsapp-numbers.module';

@Module({
  imports: [PrismaModule, ConfigModule, WhatsAppNumbersModule],
  controllers: [ChannelsController],
  providers: [ChannelsService],
  exports: [ChannelsService],
})
export class ChannelsModule {}
