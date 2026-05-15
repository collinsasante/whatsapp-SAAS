import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';
import { JwtPayload } from '@whatsapp-platform/shared-types';
import {
  CannedResponsesService,
  CreateCannedDto,
  UpdateCannedDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './canned-responses.service';

@UseGuards(JwtAuthGuard)
@Controller('canned-responses')
export class CannedResponsesController {
  constructor(private service: CannedResponsesService) {}

  // ── Categories ────────────────────────────────────────────────────────────

  @Get('categories')
  listCategories(@CurrentUser() user: JwtPayload) {
    return this.service.listCategories(user.tenantId);
  }

  @Post('categories')
  createCategory(@CurrentUser() user: JwtPayload, @Body() dto: CreateCategoryDto) {
    return this.service.createCategory(user.tenantId, dto);
  }

  @Patch('categories/:id')
  updateCategory(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.service.updateCategory(id, user.tenantId, dto);
  }

  @Delete('categories/:id')
  deleteCategory(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.deleteCategory(id, user.tenantId);
  }

  // ── Canned Responses ──────────────────────────────────────────────────────

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.service.list(user.tenantId, user.sub);
  }

  @Get('search')
  search(
    @CurrentUser() user: JwtPayload,
    @Query('q') q = '',
    @Query('categoryId') categoryId?: string,
  ) {
    return this.service.search(user.tenantId, user.sub, q, categoryId);
  }

  @Get('favorites')
  favorites(@CurrentUser() user: JwtPayload) {
    return this.service.getFavorites(user.tenantId, user.sub);
  }

  @Get('recent')
  recent(@CurrentUser() user: JwtPayload) {
    return this.service.getRecent(user.tenantId, user.sub);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCannedDto) {
    return this.service.create(user.tenantId, user.sub, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateCannedDto) {
    return this.service.update(id, user.tenantId, user.sub, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.remove(id, user.tenantId);
  }

  @Post(':id/favorite')
  toggleFavorite(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.toggleFavorite(id, user.tenantId, user.sub);
  }

  @Post(':id/use')
  trackUsage(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.trackUsage(id, user.tenantId, user.sub);
  }
}
