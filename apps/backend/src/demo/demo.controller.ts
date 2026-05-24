import {
  Controller, Post, Get, Body, Query,
  Ip, HttpCode, HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DemoService } from './demo.service';
import { CreateDemoDto } from './dto/create-demo.dto';

@Controller('demo')
export class DemoController {
  constructor(private readonly service: DemoService) {}

  @Get('slots')
  getSlots(@Query('date') date: string) {
    return this.service.getAvailableSlots(date);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 600000 } })
  create(@Body() dto: CreateDemoDto, @Ip() ip: string) {
    return this.service.create(dto, ip);
  }
}
