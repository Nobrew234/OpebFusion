import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';
import { MessageDto } from './message.dto';

export class ChatCompletionRequestDto {
  @IsString()
  @IsNotEmpty()
  model: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => MessageDto)
  messages: MessageDto[];

  @IsOptional()
  @IsBoolean()
  stream?: boolean;

  @IsOptional()
  @IsNumber()
  temperature?: number;

  @IsOptional()
  @IsNumber()
  top_p?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  max_tokens?: number;

  // string or array of strings; class-validator has no built-in union
  // validator for this, so accept either shape without further constraint.
  @IsOptional()
  stop?: string | string[];

  // Accepted for compatibility only. Spec 001: "o MVP deve repassar apenas
  // quando a rota permitir" — routing/delegation policy doesn't exist yet
  // (spec 002), so the fake orchestrator ignores this entirely.
  @IsOptional()
  @IsArray()
  tools?: unknown[];

  @IsOptional()
  tool_choice?: unknown;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
