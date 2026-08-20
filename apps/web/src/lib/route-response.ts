import { NextResponse } from 'next/server';
import { sseEventSchema } from '@chat-app/contracts';
import { ApiClientError } from './api-client';
import { clearSessionCookie } from './session-cookie';
import { SseParser, type ParsedSseEvent } from './sse';
export function jsonError(error: unknown): NextResponse {
  if (error instanceof ApiClientError) {
    const response = NextResponse.json({ error: error.message }, { status: error.status });
    return error.status === 404 || error.status === 410 ? clearSessionCookie(response) : response;
  }
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
export function requireSessionId(
  cookieHeader: string | null,
  readSessionId: (header: string | null) => string | null,
): string | NextResponse {
  const sessionId = readSessionId(cookieHeader);
  return sessionId ?? NextResponse.json({ sessionExpired: true }, { status: 401 });
}
export function sseResponse(upstream: Response): Response {
  const headers = new Headers({
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'content-type': 'text/event-stream',
    'x-accel-buffering': 'no',
  });
  return new Response(sanitizeSseStream(upstream.body), { status: upstream.status, headers });
}
function sanitizeSseStream(
  body: ReadableStream<Uint8Array> | null,
): ReadableStream<Uint8Array> | null {
  if (!body) return null;
  const parser = new SseParser();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        publishSafeEvents(
          parser.push(decoder.decode(chunk, { stream: true })),
          controller,
          encoder,
        );
      },
      flush(controller) {
        publishSafeEvents(parser.push(decoder.decode()), controller, encoder);
        publishSafeEvents(parser.finish(), controller, encoder);
      },
    }),
  );
}
function publishSafeEvents(
  events: ParsedSseEvent[],
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
): void {
  for (const event of events) {
    const safe = safeSseEvent(event);
    if (!safe) continue;
    const id = event.id?.replaceAll(/[\r\n]/g, '');
    const prefix = id ? `id: ${id}\n` : '';
    controller.enqueue(
      encoder.encode(`${prefix}event: ${safe.type}\ndata: ${JSON.stringify(safe)}\n\n`),
    );
  }
}
function safeSseEvent(event: ParsedSseEvent) {
  try {
    const payload: unknown = JSON.parse(event.data);
    const typedPayload =
      typeof payload === 'object' &&
      payload !== null &&
      !('type' in payload) &&
      event.event !== 'message'
        ? { ...payload, type: event.event }
        : payload;
    const parsed = sseEventSchema.safeParse(typedPayload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
