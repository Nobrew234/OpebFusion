import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.interfaces';
import type { FinishReason } from '../orchestration/orchestration.interfaces';
import { ChatCompletionsService } from './chat-completions.service';
import { ChatCompletionRequestDto } from './dto/chat-completion-request.dto';

interface ChunkDelta {
  role?: 'assistant';
  content?: string;
}

@Controller('chat/completions')
@UseGuards(AuthGuard)
export class ChatCompletionsController {
  constructor(
    private readonly chatCompletionsService: ChatCompletionsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async create(
    @Body() dto: ChatCompletionRequestDto,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    if (dto.stream) {
      await this.handleStreaming(dto, req, res);
      return;
    }

    const envelope = await this.chatCompletionsService.createCompletion(
      dto,
      req.apiKey,
    );
    res.status(200).json(envelope);
  }

  private async handleStreaming(
    dto: ChatCompletionRequestDto,
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    // All validation/route/auth checks happen inside prepareStream and throw
    // synchronously here, before any header is set — a failure at this point
    // propagates as a normal HTTP error response (see AGENTS.md: failure
    // before the first chunk => HTTP error envelope, never a half-open
    // stream).
    const { id, created, model, chunks } =
      this.chatCompletionsService.prepareStream(dto, req.apiKey);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const writeChunk = (
      delta: ChunkDelta,
      finishReason: FinishReason | null,
    ) => {
      const chunk = {
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    };

    // OpenAI-compatible clients expect an initial role-only chunk before content.
    writeChunk({ role: 'assistant' }, null);

    try {
      for await (const chunk of chunks) {
        if (chunk.finishReason !== null) {
          writeChunk({}, chunk.finishReason);
        } else {
          writeChunk({ content: chunk.delta }, null);
        }
      }
    } catch {
      // Failure after the stream started: close it in a controlled way
      // without leaking any internal detail (stack trace, provider error,
      // secret) to the client — AGENTS.md's non-negotiable rule.
    }

    res.write('data: [DONE]\n\n');
    res.end();
  }
}
