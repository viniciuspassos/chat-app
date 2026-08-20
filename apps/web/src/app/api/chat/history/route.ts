import { NextResponse, type NextRequest } from 'next/server';
import { getBackendHistory } from '@/lib/api-client';
import { sanitizeBackendHistory } from '@/lib/browser-chat';
import { jsonError, requireSessionId } from '@/lib/route-response';
import { readSessionId } from '@/lib/session-cookie';
export const runtime = 'edge';
export async function GET(request: NextRequest): Promise<NextResponse> {
  const sessionId = requireSessionId(request.headers.get('cookie'), readSessionId);
  if (sessionId instanceof NextResponse) return sessionId;
  try {
    return NextResponse.json(sanitizeBackendHistory(await getBackendHistory(sessionId)));
  } catch (error: unknown) {
    return jsonError(error);
  }
}
