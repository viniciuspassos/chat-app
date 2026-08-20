import { describe, expect, it } from 'vitest';
import { CompactSummaryPort } from '../src/context/compact-summary.port.js';
import {
  ContextSelectorService,
  type TokenCounterPort,
} from '../src/context/context-selector.service.js';
import type { ConversationExchange, SummaryPort } from '../src/domain/types.js';

class CharacterCounter implements TokenCounterPort {
  public count(text: string): number {
    return text.length;
  }
}

class FixedSummaryPort implements SummaryPort {
  public constructor(private readonly result: string) {}

  public summarize(): Promise<string> {
    return Promise.resolve(this.result);
  }
}

function exchange(id: string, userMessage: string): ConversationExchange {
  return { id, userMessage, blocks: [{ type: 'text', text: `answer to ${userMessage}` }] };
}
function sizedExchange(id: string, tokens: number): ConversationExchange {
  return {
    id,
    userMessage: '',
    blocks: [{ type: 'text', text: `${id}${'x'.repeat(tokens - id.length)}` }],
  };
}
function selectedExchangeIds(messages: readonly { readonly content: string }[]): string[] {
  return messages
    .filter((message) => /^(?:[0-3]|r)x*$/.test(message.content))
    .map((message) => message.content);
}

describe('ContextSelectorService', () => {
  it('omits an oversized latest tool exchange without splitting it', async () => {
    const selector = new ContextSelectorService(
      new CharacterCounter(),
      new FixedSummaryPort(''),
      1,
    );

    const context = await selector.select(
      [
        {
          id: 'turn',
          userMessage: 'x',
          blocks: [
            {
              type: 'tool_use',
              id: 'call',
              name: 'write_file',
              input: { content: 'large generated source' },
              server: 'writer',
            },
            { type: 'tool_result', toolUseId: 'call', content: 'result', isError: false },
          ],
        },
      ],
      '',
    );

    expect(context.messages).toEqual([]);
  });

  it('keeps all configured recent exchanges when they fit', async () => {
    const selector = new ContextSelectorService(
      new CharacterCounter(),
      new FixedSummaryPort(''),
      10,
      3,
    );

    const context = await selector.select(
      [sizedExchange('0', 2), sizedExchange('1', 2), sizedExchange('2', 2), sizedExchange('3', 2)],
      '',
    );

    expect(selectedExchangeIds(context.messages)).toEqual(['1x', '2x', '3x']);
  });

  it('drops older exchanges first when only some recent exchanges fit', async () => {
    const selector = new ContextSelectorService(
      new CharacterCounter(),
      new FixedSummaryPort(''),
      7,
      4,
    );

    const context = await selector.select(
      [sizedExchange('0', 2), sizedExchange('1', 2), sizedExchange('2', 3), sizedExchange('3', 4)],
      '',
    );

    expect(selectedExchangeIds(context.messages)).toEqual(['2xx', '3xxx']);
  });

  it('keeps tool use and result blocks together in a selected exchange', async () => {
    const selector = new ContextSelectorService(
      new CharacterCounter(),
      new FixedSummaryPort(''),
      100,
    );
    const context = await selector.select(
      [
        {
          id: 'tool-turn',
          userMessage: 'question',
          blocks: [
            { type: 'tool_use', id: 'call', name: 'lookup', input: { id: '1' }, server: 'search' },
            { type: 'tool_result', toolUseId: 'call', content: 'answer', isError: false },
          ],
        },
      ],
      '',
    );

    expect(context.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool']);
  });

  it('accounts for summary and recent exchanges without exceeding the budget', async () => {
    const summary = { throughExchangeId: 'old', text: 'sum' };
    const selector = new ContextSelectorService(
      new CharacterCounter(),
      new FixedSummaryPort(''),
      39,
      2,
    );

    const context = await selector.select(
      [sizedExchange('o', 5), sizedExchange('r', 2)],
      'sys',
      summary,
    );

    expect(context.summary).toEqual(summary);
    expect(selectedExchangeIds(context.messages)).toEqual(['rx']);
    expect(context.messages.reduce((total, message) => total + message.content.length, 0)).toBe(39);
  });

  it('handles empty history and no summary', async () => {
    const selector = new ContextSelectorService(
      new CharacterCounter(),
      new FixedSummaryPort(''),
      10,
    );

    await expect(selector.select([], '')).resolves.toEqual({ messages: [] });
  });

  it('selects deterministically', async () => {
    const selector = new ContextSelectorService(
      new CharacterCounter(),
      new FixedSummaryPort(''),
      5,
      3,
    );
    const history = [sizedExchange('0', 1), sizedExchange('1', 2), sizedExchange('2', 3)];

    const [first, second] = await Promise.all([
      selector.select(history, ''),
      selector.select(history, ''),
    ]);

    expect(first).toEqual(second);
  });

  it('does not advance a persisted summary cursor when new content was not summarized', async () => {
    const previous = { throughExchangeId: 'turn-0', text: 'saved summary' };
    const selector = new ContextSelectorService(
      new CharacterCounter(),
      new FixedSummaryPort(previous.text),
      10_000,
      1,
    );

    const context = await selector.select(
      [exchange('turn-0', 'old'), exchange('turn-1', 'newer'), exchange('turn-2', 'recent')],
      'system',
      previous,
    );

    expect(context.summary).toEqual(previous);
  });
});

describe('CompactSummaryPort', () => {
  it('reserves space for the newest compacted exchanges', async () => {
    const summary = new CompactSummaryPort(80);

    const result = await summary.summarize([exchange('turn', 'latest request')], 'P'.repeat(80));

    expect(result).toContain('User: latest request');
    expect(result).toContain('Assistant: answer to latest request');
  });
});
