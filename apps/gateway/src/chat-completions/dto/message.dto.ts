import { IsIn, IsString } from 'class-validator';

export const CHAT_MESSAGE_ROLES = [
  'system',
  'user',
  'assistant',
  'tool',
] as const;
export type ChatMessageRole = (typeof CHAT_MESSAGE_ROLES)[number];

export class MessageDto {
  @IsIn(CHAT_MESSAGE_ROLES)
  role: ChatMessageRole;

  @IsString()
  content: string;
}
