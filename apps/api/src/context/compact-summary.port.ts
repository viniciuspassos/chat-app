import type { ConversationExchange, SummaryPort } from '../domain/types';
export class CompactSummaryPort implements SummaryPort {
  public constructor(private readonly maximumCharacters = 8_000) {}
  summarize(exchanges: readonly ConversationExchange[], previousSummary?: string): Promise<string> {
    const latest = exchanges.map(exchangeLine).join('\n');
    if (!previousSummary) return Promise.resolve(truncate(latest, this.maximumCharacters));
    if (latest.length >= this.maximumCharacters)
      return Promise.resolve(truncate(latest, this.maximumCharacters));
    return Promise.resolve(
      `${truncate(previousSummary, this.maximumCharacters - latest.length - 1)}\n${latest}`,
    );
  }
}
function exchangeLine(exchange: ConversationExchange): string {
  return `User: ${exchange.userMessage}\n${exchange.blocks.map(detail).join('\n')}`;
}
function detail(block: ConversationExchange['blocks'][number]): string {
  if (block.type === 'text') return `Assistant: ${block.text}`;
  if (block.type === 'tool_use') return `Tool call ${block.name}: ${JSON.stringify(block.input)}`;
  if (block.type === 'tool_result') return `Tool result: ${block.content}`;
  return JSON.stringify(block);
}
function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, Math.max(0, maximum - 1))}…`;
}
