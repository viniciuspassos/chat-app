import { describe, expect, it } from 'vitest';
import { createChatMessage } from '../src/models/chat-message';

describe('createChatMessage', () => {
  it('creates a message with its stable identity, role, and content', () => {
    expect(createChatMessage(7, 'bot', 'Bot: hello')).toEqual({
      body: 'Bot: hello',
      id: 7,
      role: 'bot',
    });
  });
});
