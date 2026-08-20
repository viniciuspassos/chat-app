import type { CanonicalDelta, ContentBlock, InternalTurnEvent } from '@chat-app/contracts';

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface LlmTurnRequest {
  readonly messages: readonly LlmMessage[];
  readonly tools: readonly LlmToolDefinition[];
}

export interface LlmTextMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface LlmFunctionCallMessage {
  readonly role: 'assistant';
  readonly content: string;
  readonly functionCall: { readonly id: string; readonly name: string; readonly arguments: string };
}

export interface LlmFunctionCallOutputMessage {
  readonly role: 'tool';
  readonly content: string;
  readonly callId: string;
}

export type LlmMessage = LlmTextMessage | LlmFunctionCallMessage | LlmFunctionCallOutputMessage;

export interface LlmToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface LlmProviderPort {
  stream(request: LlmTurnRequest, signal: AbortSignal): AsyncIterable<CanonicalDelta>;
}

export interface McpToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly server: 'search' | 'writer';
}

export interface McpToolResult {
  readonly content: string;
  readonly isError: boolean;
}

export interface McpToolClientPort {
  listTools(): Promise<readonly LlmToolDefinition[]>;
  call(tool: McpToolCall): Promise<McpToolResult>;
}

export interface TurnEventSink {
  publish(event: InternalTurnEvent): Promise<void>;
}
export interface TurnTransactionPort {
  commit(turnId: string): Promise<void>;
  rollback(turnId: string): Promise<void>;
}
export interface ClockPort {
  now(): number;
}

export interface ConversationExchange {
  readonly id: string;
  readonly userMessage: string;
  readonly blocks: readonly ContentBlock[];
}

export interface ConversationRepositoryPort {
  list(sessionId: string): Promise<readonly ConversationExchange[]>;
  append(sessionId: string, exchange: ConversationExchange): Promise<void>;
}

export interface SummaryPort {
  summarize(exchanges: readonly ConversationExchange[], previousSummary?: string): Promise<string>;
}
