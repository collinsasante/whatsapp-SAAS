import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWhatsAppNumberDto, UpdateWhatsAppNumberDto } from './dto/whatsapp-number.dto';

@Injectable()
export class WhatsAppNumbersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.whatsAppNumber.findMany({
      where: { tenantId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(tenantId: string, id: string) {
    const num = await this.prisma.whatsAppNumber.findFirst({ where: { id, tenantId } });
    if (!num) throw new NotFoundException('WhatsApp number not found');
    return num;
  }

  async create(tenantId: string, dto: CreateWhatsAppNumberDto) {
    const existing = await this.prisma.whatsAppNumber.findUnique({
      where: { tenantId_phoneNumberId: { tenantId, phoneNumberId: dto.phoneNumberId } },
    });
    if (existing) {
      throw new ConflictException(`Phone number ID ${dto.phoneNumberId} is already registered for this workspace`);
    }

    // First number created is auto-default
    const count = await this.prisma.whatsAppNumber.count({ where: { tenantId } });
    const isDefault = dto.isDefault ?? count === 0;

    if (isDefault) {
      await this.clearDefault(tenantId);
    }

    const num = await this.prisma.whatsAppNumber.create({
      data: {
        tenantId,
        label: dto.label,
        phoneNumberId: dto.phoneNumberId,
        wabaId: dto.wabaId,
        accessToken: dto.accessToken,
        isDefault,
      },
    });

    if (isDefault) {
      await this.syncDefaultToTenant(tenantId, num.phoneNumberId, num.wabaId, num.accessToken);
    }

    return num;
  }

  async update(tenantId: string, id: string, dto: UpdateWhatsAppNumberDto) {
    await this.findOne(tenantId, id);

    if (dto.phoneNumberId) {
      const conflict = await this.prisma.whatsAppNumber.findFirst({
        where: { tenantId, phoneNumberId: dto.phoneNumberId, NOT: { id } },
      });
      if (conflict) {
        throw new ConflictException(`Phone number ID ${dto.phoneNumberId} is already registered for this workspace`);
      }
    }

    const updated = await this.prisma.whatsAppNumber.update({
      where: { id },
      data: {
        ...(dto.label         !== undefined && { label:         dto.label }),
        ...(dto.phoneNumberId !== undefined && { phoneNumberId: dto.phoneNumberId }),
        ...(dto.wabaId        !== undefined && { wabaId:        dto.wabaId }),
        ...(dto.accessToken   !== undefined && { accessToken:   dto.accessToken }),
        ...(dto.isActive      !== undefined && { isActive:      dto.isActive }),
      },
    });

    // Keep tenant creds in sync if this is the default number
    if (updated.isDefault) {
      await this.syncDefaultToTenant(
        tenantId,
        updated.phoneNumberId,
        updated.wabaId,
        updated.accessToken,
      );
    }

    return updated;
  }

  async setDefault(tenantId: string, id: string) {
    const num = await this.findOne(tenantId, id);
    if (!num.isActive) {
      throw new BadRequestException('Cannot set an inactive number as default');
    }

    await this.clearDefault(tenantId);

    const updated = await this.prisma.whatsAppNumber.update({
      where: { id },
      data: { isDefault: true },
    });

    await this.syncDefaultToTenant(tenantId, updated.phoneNumberId, updated.wabaId, updated.accessToken);

    return updated;
  }

  async remove(tenantId: string, id: string) {
    const num = await this.findOne(tenantId, id);

    if (num.isDefault) {
      const count = await this.prisma.whatsAppNumber.count({ where: { tenantId } });
      if (count > 1) {
        throw new BadRequestException(
          'Cannot delete the default number while other numbers exist. Set another number as default first.',
        );
      }
    }

    await this.prisma.whatsAppNumber.delete({ where: { id } });
    return { success: true };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private async clearDefault(tenantId: string) {
    await this.prisma.whatsAppNumber.updateMany({
      where: { tenantId, isDefault: true },
      data: { isDefault: false },
    });
  }

  private async syncDefaultToTenant(
    tenantId: string,
    phoneNumberId: string,
    wabaId: string,
    accessToken: string,
  ) {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { phoneNumberId, wabaId, accessToken },
    });
  }

  // ─── Internal use (credential resolution) ───────────────────────────────────

  async getDefaultForTenant(tenantId: string) {
    return this.prisma.whatsAppNumber.findFirst({
      where: { tenantId, isDefault: true, isActive: true },
    });
  }

  async getByPhoneNumberId(tenantId: string, phoneNumberId: string) {
    return this.prisma.whatsAppNumber.findUnique({
      where: { tenantId_phoneNumberId: { tenantId, phoneNumberId } },
    });
  }
}
