import { afterEach, describe, expect, it, vi } from 'vitest';
import { reconnectBackendChat } from '@/lib/api-client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reconnectBackendChat', () => {
  it('forwards Last-Event-ID when replaying a turn through the BFF', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await reconnectBackendChat('session-1', 'turn-1', '42-0');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api:3001/sessions/session-1/turns/turn-1/stream',
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as { readonly headers: Headers };
    expect(request.headers.get('last-event-id')).toBe('42-0');
    expect(request.headers.get('x-copilot-session-id')).toBe('session-1');
  });
});
