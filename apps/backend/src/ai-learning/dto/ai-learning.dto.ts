import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { TakeoverClassification, CorrectionCategory, TrainingExampleStatus } from '@prisma/client';

export class SubmitFeedbackDto {
  @ApiProperty({ enum: ['GOOD', 'BAD'] })
  @IsIn(['GOOD', 'BAD'])
  rating: 'GOOD' | 'BAD';

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(80)
  reason?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(2000)
  expectedAction?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(2000)
  expectedResponse?: string;

  @ApiProperty({ enum: TakeoverClassification, required: false })
  @IsOptional() @IsEnum(TakeoverClassification)
  takeoverClassification?: TakeoverClassification;

  @ApiProperty({ enum: CorrectionCategory, required: false })
  @IsOptional() @IsEnum(CorrectionCategory)
  correctionCategory?: CorrectionCategory;
}

export class RecordCorrectionDto {
  @ApiProperty()
  @IsString()
  correctionMessageId: string;

  @ApiProperty({ enum: CorrectionCategory })
  @IsEnum(CorrectionCategory)
  category: CorrectionCategory;

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(2000)
  reviewerNotes?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(2000)
  expectedInterpretation?: string;
}

export class SetTrainingExampleStatusDto {
  @ApiProperty({ enum: TrainingExampleStatus })
  @IsEnum(TrainingExampleStatus)
  status: TrainingExampleStatus;
}
