import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
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

/**
 * The global ValidationPipe uses enableImplicitConversion, which turns the string "false" into boolean true (and "" into false). These are
 * safety switches, so the raw JSON value is kept and @IsBoolean accepts only a real boolean.
 */
const rawValue = ({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown => obj[key];

export class UpdateLearningSettingsDto {
  @ApiProperty({ required: false, description: 'Opt this workspace in to (or out of) AI learning. Off by default. Switching on needs acknowledgeDisclosure.' })
  @ValidateIf((_o, v) => v !== undefined) @Transform(rawValue) @IsBoolean()
  learningEnabled?: boolean;

  @ApiProperty({ required: false, description: 'Pause or resume learning without changing the opt-in.' })
  @ValidateIf((_o, v) => v !== undefined) @Transform(rawValue) @IsBoolean()
  learningPaused?: boolean;

  @ApiProperty({ required: false, description: 'Whether approved guidance is used in replies. Independent of the learning switches.' })
  @ValidateIf((_o, v) => v !== undefined) @Transform(rawValue) @IsBoolean()
  approvedGuidanceEnabled?: boolean;

  @ApiProperty({ required: false, description: 'The version of the learning notice the administrator has read (from GET /ai-learning/settings). Required to switch learning on, and to resume after the notice changed.' })
  @IsOptional() @IsString() @MaxLength(64)
  acknowledgedDisclosureVersion?: string;
}
