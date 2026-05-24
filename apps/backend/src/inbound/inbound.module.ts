import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InboundController } from './inbound.controller';
import { InboundService } from './inbound.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailService } from '../common/email.service';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [InboundController],
  providers: [InboundService, EmailService],
})
export class InboundModule {}
