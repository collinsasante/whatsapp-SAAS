import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  create(tenantId: string, dto: CreateProductDto) {
    return this.prisma.product.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        sku: dto.sku,
        priceMajorUnits: dto.priceMajorUnits,
        currency: dto.currency ?? 'GHS',
        imageUrl: dto.imageUrl,
        stockQuantity: dto.stockQuantity,
        minOrderQuantity: dto.minOrderQuantity,
        variants: dto.variants as never,
      },
    });
  }

  findAll(tenantId: string, activeOnly = false) {
    return this.prisma.product.findMany({
      where: { tenantId, ...(activeOnly ? { isActive: true } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const product = await this.prisma.product.findFirst({ where: { id, tenantId } });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async update(tenantId: string, id: string, dto: UpdateProductDto) {
    await this.findOne(tenantId, id); // tenant-scoped existence check before the write
    return this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.priceMajorUnits !== undefined && { priceMajorUnits: dto.priceMajorUnits }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
        ...(dto.stockQuantity !== undefined && { stockQuantity: dto.stockQuantity }),
        ...(dto.minOrderQuantity !== undefined && { minOrderQuantity: dto.minOrderQuantity }),
        ...(dto.variants !== undefined && { variants: dto.variants as never }),
      },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    // Soft-delete via isActive rather than a hard delete -- OrderItem snapshots the
    // product name/price at purchase time, but still holds an optional FK to this row,
    // and a hard delete of a product with order history would need the FK to be nullable
    // (it is, onDelete: SetNull) -- soft-delete avoids that churn entirely and lets the
    // product simply stop appearing in the AI's searchable catalogue.
    return this.prisma.product.update({ where: { id }, data: { isActive: false } });
  }
}
