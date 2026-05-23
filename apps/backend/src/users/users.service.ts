import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, UpdateUserDto } from './dto/create-user.dto';

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  avatarUrl: true,
  isActive: true,
  lastSeenAt: true,
  createdAt: true,
  tenantId: true,
};

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateUserDto) {
    // Enforce plan limit: agents
    const [sub, agentCount] = await Promise.all([
      this.prisma.subscription.findUnique({ where: { tenantId }, include: { plan: true } }),
      this.prisma.user.count({ where: { tenantId, isActive: true, isAiAgent: false } }),
    ]);
    if (sub && sub.plan.limMaxAgents > 0 && agentCount >= sub.plan.limMaxAgents) {
      throw new ForbiddenException(`Agent limit reached (${sub.plan.limMaxAgents} on your plan). Upgrade to add more agents.`);
    }

    const existing = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email: dto.email } },
    });
    if (existing) throw new ConflictException('User with this email already exists');

    const passwordHash = await bcrypt.hash(dto.password, 12);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          tenantId,
          email: dto.email,
          name: dto.name,
          passwordHash,
          role: dto.role ?? 'AGENT',
        },
        select: USER_SELECT,
      });

      // Register as workspace member so JWT validation picks up the correct role
      await tx.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: tenantId, userId: user.id } },
        create: {
          workspaceId: tenantId,
          userId: user.id,
          role: dto.role === 'ADMIN' ? 'ADMIN' : 'AGENT',
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
        update: {},
      });

      return user;
    });
  }

  async findAll(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId },
      select: USER_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async update(tenantId: string, userId: string, dto: UpdateUserDto) {
    await this.findOne(tenantId, userId);

    const data: Record<string, unknown> = {};
    if (dto.name) data['name'] = dto.name;
    if (dto.role) data['role'] = dto.role;
    if (dto.password) data['passwordHash'] = await bcrypt.hash(dto.password, 12);

    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: USER_SELECT,
    });
  }

  async deactivate(tenantId: string, userId: string) {
    await this.findOne(tenantId, userId);
    return this.prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
      select: USER_SELECT,
    });
  }
}
