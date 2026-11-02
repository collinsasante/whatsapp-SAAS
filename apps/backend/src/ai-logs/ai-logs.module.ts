import { Module } from '@nestjs/common';
import { AiLogsService } from './ai-logs.service';
import { AiLogsController } from './ai-logs.controller';
import { AiModule } from '../ai/ai.module';
import { SimulationLimitsModule } from '../ai-core/simulation/simulation-limits.module';
import { AiCoreModule } from '../ai-core/ai-core.module';

@Module({
  // AiCoreModule's import graph does not reach AiLogsModule or MessagesModule (checked from the module metadata and enforced by
  // ai-logs.module-graph.spec.ts), so this is a plain import with no forwardRef.
  imports: [AiModule, SimulationLimitsModule, AiCoreModule],
  controllers: [AiLogsController],
  providers: [AiLogsService],
  exports: [AiLogsService],
})
export class AiLogsModule {}
