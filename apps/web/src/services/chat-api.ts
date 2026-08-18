import type { ChatRequest, ChatResponse } from '@chat-app/contracts';

export const CHAT_ERROR_MESSAGES = {
  badRequest: 'Message cannot be empty.',
  network: 'Connection lost, please retry.',
  rateLimit: 'Too many messages, please try again later.',
  request: 'Request could not be completed.',
  service: 'Service unavailable, please retry.',
} as const;

export interface ChatApi {
  sendMessage(message: string): Promise<ChatResponse>;
}

export type HttpRequest = (url: string, init: RequestInit) => Promise<Response>;

export function mapChatStatusToMessage(status: number): string {
  if (status === 400) return CHAT_ERROR_MESSAGES.badRequest;
  if (status === 429) return CHAT_ERROR_MESSAGES.rateLimit;
  if (status >= 500) return CHAT_ERROR_MESSAGES.service;
  return CHAT_ERROR_MESSAGES.request;
}

export function isChatResponse(payload: unknown): payload is ChatResponse {
  if (!payload || typeof payload !== 'object') return false;
  return 'reply' in payload && typeof payload.reply === 'string';
}

export function resolveApiBaseUrl(configuredUrl?: string): string {
  const apiBaseUrl = configuredUrl?.trim() || 'http://localhost:3000';
  return apiBaseUrl.replace(/\/+$/, '');
}

export async function readChatResponse(response: Response): Promise<ChatResponse> {
  try {
    const payload: unknown = await response.json();
    if (isChatResponse(payload)) return payload;
  } catch {
    // Invalid successful responses use the same safe message as unavailable services.
  }
  throw new Error(CHAT_ERROR_MESSAGES.service);
}

export class FetchChatApi implements ChatApi {
  public constructor(
    private readonly apiBaseUrl: string,
    private readonly httpRequest: HttpRequest = globalThis.fetch,
  ) {}

  public async sendMessage(message: string): Promise<ChatResponse> {
    const requestBody: ChatRequest = { message };
    let response: Response;
    try {
      response = await this.httpRequest(`${this.apiBaseUrl}/chat`, {
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
    } catch {
      throw new Error(CHAT_ERROR_MESSAGES.network);
    }
    if (!response.ok) throw new Error(mapChatStatusToMessage(response.status));
    return readChatResponse(response);
  }
}
