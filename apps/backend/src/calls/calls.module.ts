import { Module, forwardRef } from '@nestjs/common';
import { CallsService } from './calls.service';
import { CallsController } from './calls.controller';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [forwardRef(() => WhatsappModule), ActivityLogModule],
  controllers: [CallsController],
  providers: [CallsService],
  exports: [CallsService],
})
export class CallsModule {}
