import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailService } from '../common/email.service';
import { DemoService } from './demo.service';
import { DemoController, DemoAdminController } from './demo.controller';

@Module({
  imports: [PrismaModule],
  controllers: [DemoController, DemoAdminController],
  providers: [DemoService, EmailService],
})
export class DemoModule {}
