import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { SubscriptionService } from './subscription.service';
import { InvoiceService } from './invoice.service';
import { UsageService } from './usage.service';
import { EmailService } from '../common/email.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [BillingController],
  providers: [BillingService, SubscriptionService, InvoiceService, UsageService, EmailService],
  exports: [BillingService, SubscriptionService, UsageService],
})
export class BillingModule {}
