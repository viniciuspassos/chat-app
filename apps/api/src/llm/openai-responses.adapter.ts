import type { CanonicalDelta } from '@chat-app/contracts';
import type { LlmMessage, LlmProviderPort, LlmTurnRequest } from '../domain/types';

export interface ResponsesStreamPort {
  create(
    request: Record<string, unknown>,
    options: { signal: AbortSignal },
  ): Promise<AsyncIterable<unknown>>;
}

export class OpenAiResponsesAdapter implements LlmProviderPort {
  public constructor(
    private readonly client: ResponsesStreamPort,
    private readonly model: string,
    private readonly reasoningEffort: 'low' | 'medium' | 'high' = 'medium',
  ) {}
  async *stream(request: LlmTurnRequest, signal: AbortSignal): AsyncIterable<CanonicalDelta> {
    const stream = await this.client.create(this.toRequest(request), { signal });
    for await (const event of stream) {
      const delta = normalizeResponsesEvent(event);
      if (delta) yield delta;
    }
  }
  private toRequest(request: LlmTurnRequest): Record<string, unknown> {
    return {
      model: this.model,
      stream: true,
      store: false,
      reasoning: { effort: this.reasoningEffort },
      max_output_tokens: 8_000,
      input: request.messages.map(toResponsesInput),
      tools: request.tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      })),
    };
  }
}
function toResponsesInput(message: LlmMessage): Record<string, unknown> {
  if (message.role === 'tool')
    return { type: 'function_call_output', call_id: message.callId, output: message.content };
  if ('functionCall' in message)
    return {
      type: 'function_call',
      call_id: message.functionCall.id,
      name: message.functionCall.name,
      arguments: message.functionCall.arguments,
    };
  return { role: message.role, content: message.content };
}
export function normalizeResponsesEvent(event: unknown): CanonicalDelta | undefined {
  if (!isRecord(event) || typeof event.type !== 'string') return undefined;
  if (event.type === 'response.output_item.added') return itemStarted(event);
  if (event.type === 'response.output_text.delta') return textDelta(event);
  if (event.type === 'response.function_call_arguments.delta') return inputDelta(event);
  if (event.type === 'response.output_item.done') return itemStopped(event);
  if (event.type === 'response.completed')
    return {
      type: 'message_delta',
      stopReason: hasFunctionCall(event.response) ? 'tool_use' : 'end_turn',
    };
  return undefined;
}
function itemStarted(event: Record<string, unknown>): CanonicalDelta | undefined {
  const item = asRecord(event.item);
  const index = numberField(event, 'output_index');
  if (!item || index === undefined) return undefined;
  if (item.type === 'message') return { type: 'content_block_start', index, block: 'text' };
  if (item.type !== 'function_call') return undefined;
  const id = stringField(item, 'call_id');
  const name = stringField(item, 'name');
  if (!id || !name) return undefined;
  return {
    type: 'content_block_start',
    index,
    block: 'tool_use',
    id,
    name,
    server: serverFor(name),
  };
}
function textDelta(event: Record<string, unknown>): CanonicalDelta | undefined {
  const index = numberField(event, 'output_index');
  const delta = stringField(event, 'delta');
  return index === undefined || delta === undefined
    ? undefined
    : { type: 'text_delta', index, delta };
}
function inputDelta(event: Record<string, unknown>): CanonicalDelta | undefined {
  const index = numberField(event, 'output_index');
  const delta = stringField(event, 'delta');
  return index === undefined || delta === undefined
    ? undefined
    : { type: 'input_json_delta', index, delta };
}
function itemStopped(event: Record<string, unknown>): CanonicalDelta | undefined {
  const index = numberField(event, 'output_index');
  const item = asRecord(event.item);
  return index === undefined ||
    item === undefined ||
    (item.type !== 'message' && item.type !== 'function_call')
    ? undefined
    : { type: 'content_block_stop', index };
}
function serverFor(name: string): 'search' | 'writer' {
  return ['list_files', 'read_file', 'grep'].includes(name) ? 'search' : 'writer';
}
function hasFunctionCall(response: unknown): boolean {
  const output = asRecord(response)?.output;
  return Array.isArray(output) && output.some((item) => asRecord(item)?.type === 'function_call');
}
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}
function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
}
