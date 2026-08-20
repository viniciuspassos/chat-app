import { NextResponse, type NextRequest } from 'next/server';
import { reconnectBackendChat } from '@/lib/api-client';
import { jsonError, requireSessionId, sseResponse } from '@/lib/route-response';
import { readSessionId } from '@/lib/session-cookie';
export const runtime = 'edge';
type RouteContext = { params: Promise<{ turnId: string }> };
export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const sessionId = requireSessionId(request.headers.get('cookie'), readSessionId);
  if (sessionId instanceof NextResponse) return sessionId;
  const { turnId } = await context.params;
  if (!turnId) return NextResponse.json({ error: 'turnId is required' }, { status: 400 });
  try {
    return sseResponse(
      await reconnectBackendChat(
        sessionId,
        turnId,
        request.headers.get('last-event-id') ?? undefined,
      ),
    );
  } catch (error: unknown) {
    return jsonError(error);
  }
}
