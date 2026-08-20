import { describe, expect, it } from 'vitest';
import { NextResponse } from 'next/server';
import { ApiClientError } from '@/lib/api-client';
import { jsonError, requireSessionId, sseResponse } from '@/lib/route-response';

describe('route response helpers', () => {
  it('clears a stale cookie on a backend expiry', async () => {
    const response = jsonError(new ApiClientError(410, 'expired'));
    expect(response.cookies.get('copilot_session')?.maxAge).toBe(0);
    await expect(response.json()).resolves.toEqual({ error: 'expired' });
  });
  it('requires a cookie-derived session id', () => {
    expect(requireSessionId(null, () => null)).toBeInstanceOf(NextResponse);
    expect(requireSessionId('cookie', () => 'session')).toBe('session');
  });
  it('forwards only browser-safe SSE fields', async () => {
    const response = sseResponse(
      new Response(
        'id: 1\nevent: canonical_delta\ndata: {"type":"canonical_delta","input":"secret"}\n\nid: 2\nevent: tool\ndata: {"toolUseId":"a","name":"grep","server":"search","status":"done","arguments":{"pattern":"secret"}}\n\n',
      ),
    );
    await expect(response.text()).resolves.toBe(
      'id: 2\nevent: tool\ndata: {"type":"tool","toolUseId":"a","name":"grep","server":"search","status":"done"}\n\n',
    );
  });

  it('preserves SSE ordering through done and error terminal events', async () => {
    const response = sseResponse(
      new Response(
        'id: 1\nevent: text\ndata: {"blockIndex":0,"delta":"Working"}\n\nid: 2\nevent: done\ndata: {"turnId":"cbb6aa43-5170-4fba-b1f6-1cd26c7f5069","exchangeIndex":0}\n\nid: 3\nevent: error\ndata: {"code":"turn_failed","message":"write failed"}\n\n',
      ),
    );

    await expect(response.text()).resolves.toBe(
      'id: 1\nevent: text\ndata: {"type":"text","blockIndex":0,"delta":"Working"}\n\nid: 2\nevent: done\ndata: {"type":"done","turnId":"cbb6aa43-5170-4fba-b1f6-1cd26c7f5069","exchangeIndex":0}\n\nid: 3\nevent: error\ndata: {"type":"error","code":"turn_failed","message":"write failed"}\n\n',
    );
  });
});
