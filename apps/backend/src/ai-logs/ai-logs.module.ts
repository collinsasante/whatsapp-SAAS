import { Module } from '@nestjs/common';
import { AiLogsService } from './ai-logs.service';
import { AiLogsController } from './ai-logs.controller';
import { AiModule } from '../ai/ai.module';
import { SimulationLimitsModule } from '../ai-core/simulation/simulation-limits.module';

@Module({
  imports: [AiModule, SimulationLimitsModule],
  controllers: [AiLogsController],
  providers: [AiLogsService],
  exports: [AiLogsService],
})
export class AiLogsModule {}
