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
import { appendLog } from '../common/logging/log-file';
import { getRequestLogContext } from '../common/logging/request-context';
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
      getRequestLogContext(req),
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
    const logCtx = getRequestLogContext(req);
    const { id, created, model, chunks } =
      this.chatCompletionsService.prepareStream(dto, req.apiKey, logCtx);

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

    const start = Date.now();
    try {
      for await (const chunk of chunks) {
        if (chunk.finishReason !== null) {
          writeChunk({}, chunk.finishReason);
        } else {
          writeChunk({ content: chunk.delta }, null);
        }
      }
    } catch (err) {
      // Failure after the stream started: close it in a controlled way without
      // leaking any internal detail (stack trace, provider error, secret) to
      // the client. Unlike a pre-first-chunk failure — which surfaces as an
      // HTTP error envelope — this one cannot; but it must NOT be swallowed
      // silently (spec 006). We record an `error` entry with the requestId,
      // failure category and latency, and flag the context so the interceptor's
      // completion line is not mistaken for a clean success.
      logCtx.streamError = true;
      appendLog('error', 'request.failed', {
        requestId: logCtx.requestId,
        method: req.method,
        path: req.url,
        model,
        stream: true,
        phase: 'stream',
        category: categorizeStreamFailure(err),
        ms: Date.now() - start,
        // Raw message is sanitized centrally by appendLog before persistence.
        error: err instanceof Error ? err.message : String(err),
      });
    }

    res.write('data: [DONE]\n\n');
    res.end();
  }
}

/**
 * Coarse failure category for a mid-stream error, kept internal (never sent to
 * the client). Enough to tell a timeout apart from a provider/upstream fault or
 * an unexpected internal error when reading logs.
 */
function categorizeStreamFailure(err: unknown): string {
  const name = err instanceof Error ? err.name.toLowerCase() : '';
  const message = err instanceof Error ? err.message.toLowerCase() : '';
  if (name.includes('timeout') || message.includes('timeout')) {
    return 'timeout';
  }
  if (name.includes('abort') || message.includes('aborted')) {
    return 'aborted';
  }
  if (
    message.includes('provider') ||
    message.includes('upstream') ||
    message.includes('fetch') ||
    message.includes('network')
  ) {
    return 'provider_error';
  }
  return 'internal_error';
}
