import { Module } from '@nestjs/common';
import { ChatbotFlowsService } from './chatbot-flows.service';
import { ChatbotFlowsController } from './chatbot-flows.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ChatbotFlowsController],
  providers: [ChatbotFlowsService],
  exports: [ChatbotFlowsService],
})
export class ChatbotFlowsModule {}
