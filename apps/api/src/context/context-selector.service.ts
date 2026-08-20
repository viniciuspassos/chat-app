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
    const system = systemMessage(systemPrompt);
    const systemTokens = messagesTokens(system, this.counter);
    if (systemTokens > this.limit)
      throw new Error(`System prompt uses ${systemTokens} tokens; limit is ${this.limit}`);

    const summary = await this.selectSummary(exchanges, previousSummary, systemTokens);
    const prefix = [...system, ...summaryMessage(summary)];
    const recent = selectRecentExchanges(
      exchanges,
      this.recentExchanges,
      this.limit - messagesTokens(prefix, this.counter),
      this.counter,
    );
    return { messages: [...prefix, ...toMessages(recent)], ...(summary ? { summary } : {}) };
  }
  private async selectSummary(
    exchanges: readonly ConversationExchange[],
    previousSummary: PersistedContextSummary | undefined,
    systemTokens: number,
  ): Promise<PersistedContextSummary | undefined> {
    const older = exchanges.slice(0, Math.max(0, exchanges.length - this.recentExchanges));
    const prior = validPreviousSummary(previousSummary, older);
    const newExchanges = prior ? older.slice(prior.index + 1) : older;
    if (newExchanges.length === 0)
      return fittingSummary(previousSummary, systemTokens, this.counter, this.limit);
    try {
      const summary = {
        text: await this.summary.summarize(newExchanges, prior?.text),
        throughExchangeId: newExchanges.at(-1)?.id ?? previousSummary?.throughExchangeId ?? '',
      };
      if (prior && previousSummary && summary.text === previousSummary.text) return previousSummary;
      return (
        fittingSummary(summary, systemTokens, this.counter, this.limit) ??
        fittingSummary(previousSummary, systemTokens, this.counter, this.limit)
      );
    } catch (error) {
      const fallback = fittingSummary(previousSummary, systemTokens, this.counter, this.limit);
      if (fallback) return fallback;
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
function messagesTokens(messages: readonly LlmMessage[], counter: TokenCounterPort): number {
  return messages.reduce((sum, message) => sum + messageTokens(message, counter), 0);
}
function summaryMessage(summary: PersistedContextSummary | undefined): LlmMessage[] {
  return summary
    ? [{ role: 'assistant', content: `Previous conversation summary:\n${summary.text}` }]
    : [];
}
function summaryTokens(summary: PersistedContextSummary, counter: TokenCounterPort): number {
  return messagesTokens(summaryMessage(summary), counter);
}
function fittingSummary(
  summary: PersistedContextSummary | undefined,
  systemTokens: number,
  counter: TokenCounterPort,
  limit: number,
): PersistedContextSummary | undefined {
  if (!summary || summaryTokens(summary, counter) + systemTokens > limit) return undefined;
  return summary;
}
function selectRecentExchanges(
  exchanges: readonly ConversationExchange[],
  maximum: number,
  budget: number,
  counter: TokenCounterPort,
): readonly ConversationExchange[] {
  if (maximum <= 0) return [];
  const selected: ConversationExchange[] = [];
  for (const exchange of exchanges.slice(-maximum).toReversed()) {
    const tokens = messagesTokens(toMessages([exchange]), counter);
    // An oversized newest exchange is omitted whole; older exchanges are also omitted to keep a contiguous suffix.
    if (tokens > budget) break;
    selected.unshift(exchange);
    budget -= tokens;
  }
  return selected;
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
