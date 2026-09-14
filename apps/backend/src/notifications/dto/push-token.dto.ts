import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MinLength } from 'class-validator';

export class RegisterPushTokenDto {
  @ApiProperty()
  @IsString()
  @MinLength(10)
  token: string;

  @ApiProperty({ enum: ['ios', 'android'] })
  @IsIn(['ios', 'android'])
  platform: 'ios' | 'android';
}

export class UnregisterPushTokenDto {
  @ApiProperty()
  @IsString()
  @MinLength(10)
  token: string;
}
