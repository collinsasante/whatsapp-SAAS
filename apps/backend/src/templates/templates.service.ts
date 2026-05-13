import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto';
import { buildPaginationMeta, getPaginationSkip } from '@whatsapp-platform/shared-utils';
import { TemplateStatus } from '@whatsapp-platform/shared-types';

@Injectable()
export class TemplatesService {
  constructor(
    private prisma: PrismaService,
    private whatsappService: WhatsAppService,
  ) {}

  async create(tenantId: string, dto: CreateTemplateDto) {
    return this.prisma.template.create({
      data: {
        tenantId,
        name: dto.name,
        language: dto.language,
        category: dto.category as never,
        components: dto.components as never,
        status: TemplateStatus.PENDING,
      },
    });
  }

  async findAll(tenantId: string, page = 1, limit = 50, status?: TemplateStatus) {
    const skip = getPaginationSkip(page, limit);
    const where: Record<string, unknown> = { tenantId };
    if (status) where['status'] = status;

    const [data, total] = await Promise.all([
      this.prisma.template.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.template.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(tenantId: string, id: string) {
    const template = await this.prisma.template.findFirst({ where: { id, tenantId } });
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }

  async update(tenantId: string, id: string, dto: UpdateTemplateDto) {
    await this.findOne(tenantId, id);
    return this.prisma.template.update({ where: { id }, data: dto as never });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.prisma.template.delete({ where: { id } });
  }

  async submit(tenantId: string, id: string) {
    const template = await this.findOne(tenantId, id);
    const components = template.components as unknown[];
    const result = await this.whatsappService.submitTemplate(tenantId, {
      name: template.name,
      language: template.language,
      category: template.category,
      components,
    });
    return this.prisma.template.update({
      where: { id },
      data: {
        status: (result.status ?? 'PENDING') as never,
        waTemplateId: result.id,
      },
    });
  }

  async removeWithMeta(tenantId: string, id: string) {
    const template = await this.findOne(tenantId, id);
    try {
      await this.whatsappService.deleteTemplate(tenantId, template.name);
    } catch {
      // best-effort — always delete locally
    }
    return this.prisma.template.delete({ where: { id } });
  }

  async sync(tenantId: string) {
    await this.whatsappService.syncTemplates(tenantId);
    return { message: 'Templates synced successfully' };
  }
}
