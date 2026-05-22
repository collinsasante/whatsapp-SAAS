import { Module } from '@nestjs/common';
import { WhatsAppNumbersController } from './whatsapp-numbers.controller';
import { WhatsAppNumbersService } from './whatsapp-numbers.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [WhatsAppNumbersController],
  providers: [WhatsAppNumbersService],
  exports: [WhatsAppNumbersService],
})
export class WhatsAppNumbersModule {}
