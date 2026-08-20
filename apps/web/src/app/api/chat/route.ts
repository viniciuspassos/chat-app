import { NextResponse, type NextRequest } from 'next/server';
import { startBackendChat } from '@/lib/api-client';
import { jsonError, requireSessionId, sseResponse } from '@/lib/route-response';
import { readSessionId } from '@/lib/session-cookie';
export const runtime = 'edge';
type ChatBody = { message?: unknown; turnId?: unknown };
function parseChatBody(value: ChatBody): { message: string; turnId: string } | null {
  return typeof value.message === 'string' &&
    value.message.trim() &&
    typeof value.turnId === 'string' &&
    value.turnId
    ? { message: value.message.trim(), turnId: value.turnId }
    : null;
}
export async function POST(request: NextRequest): Promise<Response> {
  const sessionId = requireSessionId(request.headers.get('cookie'), readSessionId);
  if (sessionId instanceof NextResponse) return sessionId;
  const body = parseChatBody((await request.json().catch(() => ({}))) as ChatBody);
  if (!body)
    return NextResponse.json({ error: 'message and turnId are required' }, { status: 400 });
  try {
    return sseResponse(await startBackendChat(sessionId, body));
  } catch (error: unknown) {
    return jsonError(error);
  }
}
