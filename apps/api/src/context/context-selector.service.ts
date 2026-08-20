import type { ConversationExchange, LlmMessage, SummaryPort } from '../domain/types';
export interface TokenCounterPort {
  count(text: string): number;
}
export interface PersistedContextSummary {
  readonly throughExchangeId: string;
  readonly text: string;
}
export interface ContextSelection {
  readonly messages: readonly LlmMessage[];
  readonly summary?: PersistedContextSummary;
}
export class ContextSelectorService {
  public constructor(
    private readonly counter: TokenCounterPort,
    private readonly summary: SummaryPort,
    private readonly limit = 32_000,
    private readonly recentExchanges = 4,
  ) {}
  async select(
    exchanges: readonly ConversationExchange[],
    systemPrompt: string,
    previousSummary?: PersistedContextSummary,
  ): Promise<ContextSelection> {
    const recent = exchanges.slice(-this.recentExchanges);
    const older = exchanges.slice(0, Math.max(0, exchanges.length - recent.length));
    const messages = [...systemMessage(systemPrompt), ...toMessages(recent)];
    const plainTokens = messages.reduce(
      (sum, message) => sum + messageTokens(message, this.counter),
      0,
    );
    if (plainTokens > this.limit)
      throw new Error(`Required context uses ${plainTokens} tokens; limit is ${this.limit}`);
    if (older.length === 0) return { messages };
    const prior = validPreviousSummary(previousSummary, older);
    const newExchanges = prior ? older.slice(prior.index + 1) : older;
    const summary = await this.summarizeOlder(newExchanges, prior, previousSummary);
    const total = plainTokens + this.counter.count(summary.text);
    if (total > this.limit)
      throw new Error(`Context summary uses ${total} tokens; limit is ${this.limit}`);
    return {
      messages: [
        ...systemMessage(systemPrompt),
        { role: 'assistant', content: `Previous conversation summary:\n${summary.text}` },
        ...toMessages(recent),
      ],
      summary,
    };
  }
  private async summarizeOlder(
    exchanges: readonly ConversationExchange[],
    prior: { readonly index: number; readonly text: string } | undefined,
    previousSummary: PersistedContextSummary | undefined,
  ): Promise<PersistedContextSummary> {
    if (prior && exchanges.length === 0 && previousSummary) return previousSummary;
    try {
      const text = await this.summary.summarize(exchanges, prior?.text);
      if (prior && previousSummary && text === previousSummary.text) return previousSummary;
      return {
        text,
        throughExchangeId: exchanges.at(-1)?.id ?? previousSummary?.throughExchangeId ?? '',
      };
    } catch (error) {
      if (previousSummary) return previousSummary;
      throw error;
    }
  }
}
function messageTokens(message: LlmMessage, counter: TokenCounterPort): number {
  return (
    counter.count(message.content) +
    counter.count('functionCall' in message ? message.functionCall.arguments : '')
  );
}
function toMessages(exchanges: readonly ConversationExchange[]): LlmMessage[] {
  return exchanges.flatMap((exchange) => [
    { role: 'user' as const, content: exchange.userMessage },
    ...exchange.blocks.map(blockMessage),
  ]);
}
function blockMessage(block: ConversationExchange['blocks'][number]): LlmMessage {
  if (block.type === 'tool_use')
    return {
      role: 'assistant',
      content: '',
      functionCall: { id: block.id, name: block.name, arguments: JSON.stringify(block.input) },
    };
  if (block.type === 'tool_result')
    return { role: 'tool', callId: block.toolUseId, content: block.content };
  return { role: 'assistant', content: block.type === 'text' ? block.text : JSON.stringify(block) };
}
function systemMessage(systemPrompt: string): LlmMessage[] {
  return systemPrompt.length === 0 ? [] : [{ role: 'system', content: systemPrompt }];
}
function validPreviousSummary(
  previous: PersistedContextSummary | undefined,
  older: readonly ConversationExchange[],
): { readonly index: number; readonly text: string } | undefined {
  if (!previous) return undefined;
  const index = older.findIndex((exchange) => exchange.id === previous.throughExchangeId);
  return index === -1 ? undefined : { index, text: previous.text };
}
