import { describe, expect, it, vi } from 'vitest';
import { readSseStream, SseParser } from '@/lib/sse';

describe('SseParser', () => {
  it('assembles split, multiline events and ignores heartbeat comments', () => {
    const parser = new SseParser();
    expect(parser.push(': ping\nid: 7\nevent: text\ndata: hello')).toEqual([]);
    expect(parser.push('\ndata: world\n\n')).toEqual([
      { id: '7', event: 'text', data: 'hello\nworld' },
    ]);
  });
  it('flushes a non-terminated last event', () => {
    const parser = new SseParser();
    parser.push('event: done\ndata: {"ok":true}');
    expect(parser.finish()).toEqual([{ event: 'done', data: '{"ok":true}' }]);
  });
});
describe('readSseStream', () => {
  it('decodes a UTF-8 response body and yields every event', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: text\ndata: ola\n\n'));
        controller.close();
      },
    });
    const listener = vi.fn();
    await readSseStream(new Response(stream), listener);
    expect(listener).toHaveBeenCalledWith({ event: 'text', data: 'ola' });
  });
});
