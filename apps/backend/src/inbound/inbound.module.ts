import { Module } from '@nestjs/common';
import { InboundController } from './inbound.controller';
import { InboundService } from './inbound.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailService } from '../common/email.service';

@Module({
  imports: [PrismaModule],
  controllers: [InboundController],
  providers: [InboundService, EmailService],
})
export class InboundModule {}
