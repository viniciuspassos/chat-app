import { describe, expect, it } from 'vitest';
import {
  chatConversationReducer,
  INITIAL_CHAT_CONVERSATION,
  type ChatConversationState,
} from '../src/state/use-chat-conversation';

describe('chatConversationReducer', () => {
  it('starts a request with a user message and clears a prior error', () => {
    const previousState: ChatConversationState = {
      ...INITIAL_CHAT_CONVERSATION,
      errorMessage: 'Prior error',
    };
    const state = chatConversationReducer(previousState, { body: 'Hello', type: 'requestStarted' });
    expect(state).toEqual({
      errorMessage: null,
      isSending: true,
      messages: [{ body: 'Hello', id: 1, role: 'user' }],
      nextMessageId: 2,
    });
  });

  it('finishes a request with the next bot message', () => {
    const pendingState = chatConversationReducer(INITIAL_CHAT_CONVERSATION, {
      body: 'Hello',
      type: 'requestStarted',
    });
    const state = chatConversationReducer(pendingState, {
      body: 'Bot: Hello',
      type: 'requestSucceeded',
    });
    expect(state.messages).toEqual([
      { body: 'Hello', id: 1, role: 'user' },
      { body: 'Bot: Hello', id: 2, role: 'bot' },
    ]);
    expect(state.isSending).toBe(false);
    expect(state.nextMessageId).toBe(3);
  });

  it('retains message history when a request fails', () => {
    const pendingState = chatConversationReducer(INITIAL_CHAT_CONVERSATION, {
      body: 'Hello',
      type: 'requestStarted',
    });
    const state = chatConversationReducer(pendingState, {
      message: 'Connection lost, please retry.',
      type: 'requestFailed',
    });
    expect(state.messages).toEqual(pendingState.messages);
    expect(state.errorMessage).toBe('Connection lost, please retry.');
    expect(state.isSending).toBe(false);
  });
});
