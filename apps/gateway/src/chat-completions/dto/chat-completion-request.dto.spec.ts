import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChatCompletionRequestDto } from './chat-completion-request.dto';

async function validateDto(payload: unknown) {
  const dto = plainToInstance(ChatCompletionRequestDto, payload);
  return validate(dto);
}

describe('ChatCompletionRequestDto validation', () => {
  const validPayload = {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hello' }],
  };

  it('passes for a minimal valid payload', async () => {
    const errors = await validateDto(validPayload);
    expect(errors).toHaveLength(0);
  });

  it('passes with all optional fields populated', async () => {
    const errors = await validateDto({
      ...validPayload,
      stream: true,
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 128,
      stop: ['\n', 'END'],
      tools: [{ type: 'function', function: { name: 'noop' } }],
      tool_choice: 'auto',
      metadata: { requestId: 'abc' },
    });
    expect(errors).toHaveLength(0);
  });

  it('fails when model is missing', async () => {
    const { model, ...rest } = validPayload;
    const errors = await validateDto(rest);
    expect(errors.some((e) => e.property === 'model')).toBe(true);
  });

  it('fails when model is empty string', async () => {
    const errors = await validateDto({ ...validPayload, model: '' });
    expect(errors.some((e) => e.property === 'model')).toBe(true);
  });

  it('fails when messages is missing', async () => {
    const { messages, ...rest } = validPayload;
    const errors = await validateDto(rest);
    expect(errors.some((e) => e.property === 'messages')).toBe(true);
  });

  it('fails when messages is an empty array', async () => {
    const errors = await validateDto({ ...validPayload, messages: [] });
    expect(errors.some((e) => e.property === 'messages')).toBe(true);
  });

  it('fails when a message has an invalid role', async () => {
    const errors = await validateDto({
      ...validPayload,
      messages: [{ role: 'admin', content: 'hi' }],
    });
    expect(errors.some((e) => e.property === 'messages')).toBe(true);
  });

  it('fails when a message content is not a string', async () => {
    const errors = await validateDto({
      ...validPayload,
      messages: [{ role: 'user', content: 42 }],
    });
    expect(errors.some((e) => e.property === 'messages')).toBe(true);
  });

  it('fails when temperature is not a number', async () => {
    const errors = await validateDto({ ...validPayload, temperature: 'hot' });
    expect(errors.some((e) => e.property === 'temperature')).toBe(true);
  });

  it('fails when max_tokens is not an integer', async () => {
    const errors = await validateDto({ ...validPayload, max_tokens: 1.5 });
    expect(errors.some((e) => e.property === 'max_tokens')).toBe(true);
  });

  it('fails when max_tokens is not positive', async () => {
    const errors = await validateDto({ ...validPayload, max_tokens: -1 });
    expect(errors.some((e) => e.property === 'max_tokens')).toBe(true);
  });

  it('fails when top_p is not a number', async () => {
    const errors = await validateDto({ ...validPayload, top_p: 'high' });
    expect(errors.some((e) => e.property === 'top_p')).toBe(true);
  });

  it('fails when stream is not a boolean', async () => {
    const errors = await validateDto({ ...validPayload, stream: 'yes' });
    expect(errors.some((e) => e.property === 'stream')).toBe(true);
  });
});
