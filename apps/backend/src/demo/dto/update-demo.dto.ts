import { IsString, IsOptional } from 'class-validator';

export class UpdateDemoDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() changedBy?: string;
}

export class AddNoteDto {
  @IsString() content: string;
  @IsOptional() @IsString() authorName?: string;
}
