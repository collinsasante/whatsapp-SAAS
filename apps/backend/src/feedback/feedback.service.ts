import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';

@Injectable()
export class FeedbackService {
  constructor(private prisma: PrismaService) {}

  create(tenantId: string, userId: string | undefined, dto: CreateFeedbackDto) {
    return this.prisma.feedback.create({
      data: {
        tenantId,
        userId: userId ?? null,
        type: dto.type,
        subject: dto.subject ?? null,
        body: dto.body,
        rating: dto.rating ?? null,
        page: dto.page ?? null,
      },
      select: { id: true, type: true, status: true, createdAt: true },
    });
  }

  list(tenantId: string, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    return this.prisma.feedback.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true, type: true, subject: true, body: true,
        rating: true, page: true, status: true, createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }

  updateStatus(id: string, tenantId: string, status: string) {
    return this.prisma.feedback.update({
      where: { id, tenantId },
      data: { status: status as never },
      select: { id: true, status: true },
    });
  }
}
