import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WorkspaceService } from './workspace.service';
import { WorkspaceController } from './workspace.controller';
import { AuditModule } from '../audit/audit.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [ConfigModule, AuditModule, RealtimeModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
