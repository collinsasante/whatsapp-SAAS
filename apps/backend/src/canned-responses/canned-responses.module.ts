import { Module } from '@nestjs/common';
import { CannedResponsesService } from './canned-responses.service';
import { CannedResponsesController } from './canned-responses.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [PrismaModule, RealtimeModule],
  controllers: [CannedResponsesController],
  providers: [CannedResponsesService],
  exports: [CannedResponsesService],
})
export class CannedResponsesModule {}
