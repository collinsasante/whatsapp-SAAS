import { IsString, IsNotEmpty } from 'class-validator';

export class UpsertSettingDto {
  @IsString()
  @IsNotEmpty()
  key: string;

  value: unknown;

  @IsString()
  @IsNotEmpty()
  description?: string;
}
