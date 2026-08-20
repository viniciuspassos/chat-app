import { describe, expect, it } from 'vitest';
import { chatReducer, initialChatState, parseChatEvent } from '@/hooks/use-chat-stream';

describe('chat reducer and event parser', () => {
  it('keeps optimistic text and applies streamed file and tool events', () => {
    const started = chatReducer(initialChatState, {
      type: 'turn_started',
      turnId: 'turn',
      text: 'crie rota',
    });
    const withText = chatReducer(started, {
      type: 'event',
      event: { type: 'text', blockIndex: 0, delta: 'Pronto' },
      eventId: '1',
    });
    const withTool = chatReducer(withText, {
      type: 'event',
      event: {
        type: 'tool',
        toolUseId: 'tool-1',
        name: 'write_file',
        server: 'writer',
        status: 'done',
      },
    });
    const withFile = chatReducer(withTool, {
      type: 'event',
      event: {
        type: 'file',
        artifactId: 'cbb6aa43-5170-4fba-b1f6-1cd26c7f5069',
        path: 'src/a.ts',
        downloadUrl: '/api/files/cbb6aa43-5170-4fba-b1f6-1cd26c7f5069',
      },
    });
    expect(withFile.messages[1]?.text).toBe('Pronto');
    expect(withFile.messages[1]?.tools[0]?.name).toBe('write_file');
    expect(withFile.messages[1]?.files[0]?.path).toBe('src/a.ts');
  });
  it('accepts named SSE payloads and drops malformed data', () => {
    expect(parseChatEvent({ event: 'text', data: '{"blockIndex":0,"delta":"oi"}' })).toEqual({
      type: 'text',
      blockIndex: 0,
      delta: 'oi',
    });
    expect(parseChatEvent({ event: 'text', data: 'not-json' })).toBeNull();
  });
});
