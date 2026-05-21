import { IsString, IsEmail, IsOptional, IsNotEmpty, MinLength } from 'class-validator';

export class CreateDemoDto {
  @IsString() @IsNotEmpty() fullName: string;
  @IsEmail() workEmail: string;
  @IsString() @IsNotEmpty() businessName: string;
  @IsString() @IsNotEmpty() businessType: string;
  @IsString() @IsNotEmpty() companySize: string;
  @IsString() @IsNotEmpty() preferredDate: string;
  @IsString() @IsNotEmpty() preferredTime: string;
  @IsString() @IsNotEmpty() timezone: string;
  @IsOptional() @IsString() phoneNumber?: string;
  @IsOptional() @IsString() currentPlatform?: string;
  @IsOptional() @IsString() @MinLength(1) goals?: string;
}
