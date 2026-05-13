import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TeamsService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string) {
    const teams = await this.prisma.team.findMany({
      where: { tenantId },
      include: { members: true },
      orderBy: { createdAt: 'asc' },
    });

    const userIds = [...new Set(teams.flatMap(t => t.members.map(m => m.userId)))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds }, tenantId },
          select: { id: true, name: true, email: true, avatarUrl: true, role: true },
        })
      : [];

    const userMap = Object.fromEntries(users.map(u => [u.id, u]));
    return teams.map(t => ({
      ...t,
      members: t.members.map(m => ({ ...m, user: userMap[m.userId] ?? null })),
    }));
  }

  async create(tenantId: string, name: string, description?: string) {
    return this.prisma.team.create({
      data: { tenantId, name, description },
      include: { members: true },
    });
  }

  async update(tenantId: string, id: string, name?: string, description?: string) {
    await this.findOne(tenantId, id);
    return this.prisma.team.update({
      where: { id },
      data: { ...(name !== undefined && { name }), ...(description !== undefined && { description }) },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.prisma.team.delete({ where: { id } });
  }

  async addMember(tenantId: string, teamId: string, userId: string) {
    await this.findOne(tenantId, teamId);
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException('User not found');
    return this.prisma.teamMember.upsert({
      where: { teamId_userId: { teamId, userId } },
      create: { teamId, userId },
      update: {},
    });
  }

  async removeMember(tenantId: string, teamId: string, userId: string) {
    await this.findOne(tenantId, teamId);
    await this.prisma.teamMember.deleteMany({ where: { teamId, userId } });
  }

  async getAvailableUsers(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true, email: true, avatarUrl: true, role: true },
      orderBy: { name: 'asc' },
    });
  }

  private async findOne(tenantId: string, id: string) {
    const team = await this.prisma.team.findFirst({ where: { id, tenantId } });
    if (!team) throw new NotFoundException('Team not found');
    return team;
  }
}
