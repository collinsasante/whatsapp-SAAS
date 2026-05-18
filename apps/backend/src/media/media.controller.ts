import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { MediaService } from './media.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { JwtPayload } from '@whatsapp-platform/shared-types';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('Media')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 512 * 1024 * 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Upload a media file (max 100MB)' })
  upload(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.mediaService.upload(tenantId, user.sub, file);
  }

  @Get()
  @ApiOperation({ summary: 'Get all media assets' })
  findAll(
    @CurrentTenant() tenantId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    return this.mediaService.findAll(tenantId, +page, +limit);
  }

  @Get('library')
  @ApiOperation({ summary: 'Get all media sent/received in conversations' })
  library(
    @CurrentTenant() tenantId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
    @Query('type') type?: string,
    @Query('search') search?: string,
  ) {
    return this.mediaService.findMessageMedia(tenantId, +page, +limit, type, search);
  }

  @Public()
  @Get('serve/:fileKey')
  async serve(@Param('fileKey') fileKey: string, @Res() res: Response) {
    const normalizedKey = fileKey.replace(/~/g, '/');
    const { stream, mimeType } = await this.mediaService.getStreamWithMime(normalizedKey);
    if (!stream) return res.status(HttpStatus.NOT_FOUND).send('File not found');
    if (mimeType) res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    stream.pipe(res);
  }

  @Delete(':id')
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.mediaService.remove(tenantId, id);
  }
}
