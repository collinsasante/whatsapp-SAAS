import { Module } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { TenantController } from './tenant.controller';
import { WhatsAppNumbersModule } from '../whatsapp-numbers/whatsapp-numbers.module';

@Module({
  imports: [WhatsAppNumbersModule],
  controllers: [TenantController],
  providers: [TenantService],
  exports: [TenantService],
})
export class TenantModule {}
