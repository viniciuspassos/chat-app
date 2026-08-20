import { describe, expect, it } from 'vitest';

import { normalizeResponsesEvent } from '../src/llm/openai-responses.adapter';

describe('normalizeResponsesEvent', () => {
  it('maps a completed function call to a tool-use stop reason', () => {
    const event = {
      type: 'response.completed',
      response: { output: [{ type: 'function_call', call_id: 'call_1' }] },
    };

    expect(normalizeResponsesEvent(event)).toEqual({
      type: 'message_delta',
      stopReason: 'tool_use',
    });
  });

  it('maps text output events to canonical deltas', () => {
    expect(
      normalizeResponsesEvent({
        type: 'response.output_text.delta',
        output_index: 2,
        delta: 'hello',
      }),
    ).toEqual({ type: 'text_delta', index: 2, delta: 'hello' });
  });
});
