import { describe, expect, it } from 'vitest';
import {
  CHAT_ERROR_MESSAGES,
  FetchChatApi,
  isChatResponse,
  mapChatStatusToMessage,
  readChatResponse,
  resolveApiBaseUrl,
  type HttpRequest,
} from '../src/services/chat-api';

class FakeHttpRequest {
  public calls: Array<{ init: RequestInit; url: string }> = [];

  public constructor(
    private readonly response?: Response,
    private readonly failure?: Error,
  ) {}

  public readonly request: HttpRequest = async (url, init) => {
    this.calls.push({ init, url });
    if (this.failure) throw this.failure;
    if (!this.response) throw new Error('FakeHttpRequest requires a response or failure.');
    return this.response;
  };
}

describe('chat API helpers', () => {
  it.each([
    [400, CHAT_ERROR_MESSAGES.badRequest],
    [401, CHAT_ERROR_MESSAGES.request],
    [429, CHAT_ERROR_MESSAGES.rateLimit],
    [503, CHAT_ERROR_MESSAGES.service],
  ])('maps HTTP %i to the expected safe message', (status, expectedMessage) => {
    expect(mapChatStatusToMessage(status)).toBe(expectedMessage);
  });

  it('recognizes only objects with a string reply', () => {
    expect(isChatResponse({ reply: 'Bot: hello' })).toBe(true);
    expect(isChatResponse({ reply: 42 })).toBe(false);
    expect(isChatResponse(null)).toBe(false);
  });

  it('uses the local API default and removes trailing slashes', () => {
    expect(resolveApiBaseUrl()).toBe('http://localhost:3000');
    expect(resolveApiBaseUrl(' https://api.example.com/// ')).toBe('https://api.example.com');
  });

  it('reads a valid successful response', async () => {
    const response = new Response(JSON.stringify({ reply: 'Bot: hello' }));
    await expect(readChatResponse(response)).resolves.toEqual({ reply: 'Bot: hello' });
  });

  it('rejects malformed successful responses with a service error', async () => {
    const response = new Response(JSON.stringify({ message: 'missing reply' }));
    await expect(readChatResponse(response)).rejects.toThrow(CHAT_ERROR_MESSAGES.service);
  });

  it('rejects invalid JSON in a successful response with a service error', async () => {
    const response = new Response('not-json');
    await expect(readChatResponse(response)).rejects.toThrow(CHAT_ERROR_MESSAGES.service);
  });
});

describe('FetchChatApi', () => {
  it('posts a shared-contract request and returns the validated reply', async () => {
    const fakeRequest = new FakeHttpRequest(
      new Response(JSON.stringify({ reply: 'Bot: hello' }), { status: 200 }),
    );
    const chatApi = new FetchChatApi('https://api.example.com', fakeRequest.request);

    await expect(chatApi.sendMessage('hello')).resolves.toEqual({ reply: 'Bot: hello' });
    expect(fakeRequest.calls).toEqual([
      {
        init: {
          body: JSON.stringify({ message: 'hello' }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        },
        url: 'https://api.example.com/chat',
      },
    ]);
  });

  it('maps an unsuccessful HTTP response without reading its body', async () => {
    const fakeRequest = new FakeHttpRequest(new Response(null, { status: 429 }));
    const chatApi = new FetchChatApi('https://api.example.com', fakeRequest.request);
    await expect(chatApi.sendMessage('hello')).rejects.toThrow(CHAT_ERROR_MESSAGES.rateLimit);
  });

  it('maps transport failures to the network message', async () => {
    const fakeRequest = new FakeHttpRequest(undefined, new TypeError('fetch failed'));
    const chatApi = new FetchChatApi('https://api.example.com', fakeRequest.request);
    await expect(chatApi.sendMessage('hello')).rejects.toThrow(CHAT_ERROR_MESSAGES.network);
  });
});
