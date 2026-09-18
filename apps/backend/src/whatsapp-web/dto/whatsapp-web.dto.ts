import { IsOptional, IsString } from 'class-validator';

export class StartWhatsAppWebSessionDto {
  @IsOptional()
  @IsString()
  name?: string;
}
