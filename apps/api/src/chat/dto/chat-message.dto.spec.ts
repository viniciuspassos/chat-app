import { plainToInstance } from 'class-transformer';
import type { TransformFnParams } from 'class-transformer';
import { validate } from 'class-validator';

import { ChatMessageDto, trimChatMessage } from './chat-message.dto';

describe('trimChatMessage', () => {
  it('removes surrounding whitespace from strings', () => {
    const parameters = { value: '  hello  ' } as TransformFnParams;

    expect(trimChatMessage(parameters)).toBe('hello');
  });

  it('preserves non-string values for validation', () => {
    const parameters = { value: 42 } as TransformFnParams;

    expect(trimChatMessage(parameters)).toBe(42);
  });
});

describe('ChatMessageDto', () => {
  it('transforms and validates a non-empty message', async () => {
    const request = plainToInstance(ChatMessageDto, { message: ' hello ' });

    await expect(validate(request)).resolves.toEqual([]);
    expect(request.message).toBe('hello');
  });

  it.each([{ message: '' }, { message: '   ' }, { message: 42 }])(
    'rejects invalid message %j',
    async (plainRequest) => {
      const request = plainToInstance(ChatMessageDto, plainRequest);

      await expect(validate(request)).resolves.not.toEqual([]);
    },
  );
});
