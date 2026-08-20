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

describe('ContextSelectorService', () => {
  it('counts function call arguments against the model context budget', async () => {
    const selector = new ContextSelectorService(
      new CharacterCounter(),
      new FixedSummaryPort(''),
      1,
    );

    await expect(
      selector.select(
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
            ],
          },
        ],
        '',
      ),
    ).rejects.toThrow('limit is 1');
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
