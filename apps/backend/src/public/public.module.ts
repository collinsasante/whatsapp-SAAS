import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [ApiKeysModule, PrismaModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
