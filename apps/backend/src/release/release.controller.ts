import { Controller, Get } from '@nestjs/common';
import { ReleaseService } from './release.service';

@Controller('public')
export class ReleasePublicController {
  constructor(private readonly svc: ReleaseService) {}

  @Get('version')
  getCurrentVersion() {
    return this.svc.getCurrentVersion();
  }
}
