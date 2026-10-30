import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ApprovedCorrectionsService } from './approved-corrections.service';

/** A leaf module (Prisma only) so the legacy responder, the v2 pipeline and Commerce can all import it without creating a cycle. */
@Module({
  imports: [PrismaModule],
  providers: [ApprovedCorrectionsService],
  exports: [ApprovedCorrectionsService],
})
export class ApprovedCorrectionsModule {}
