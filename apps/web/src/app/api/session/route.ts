import { NextResponse, type NextRequest } from 'next/server';
import {
  ApiClientError,
  createBackendSession,
  deleteBackendSession,
  getBackendHistory,
} from '@/lib/api-client';
import { sanitizeBackendHistory } from '@/lib/browser-chat';
import { jsonError, requireSessionId } from '@/lib/route-response';
import { readSessionId, setSessionCookie } from '@/lib/session-cookie';
export const runtime = 'edge';
export async function GET(request: NextRequest): Promise<NextResponse> {
  const existingSessionId = readSessionId(request.headers.get('cookie'));
  try {
    const bootstrap = await bootstrapSession(existingSessionId);
    const response = NextResponse.json(bootstrap.history);
    return bootstrap.isNew ? setSessionCookie(response, bootstrap.sessionId) : response;
  } catch (error: unknown) {
    return jsonError(error);
  }
}
async function bootstrapSession(existingSessionId: string | null): Promise<{
  sessionId: string;
  history: ReturnType<typeof sanitizeBackendHistory>;
  isNew: boolean;
}> {
  if (existingSessionId) {
    try {
      return {
        sessionId: existingSessionId,
        history: sanitizeBackendHistory(await getBackendHistory(existingSessionId)),
        isNew: false,
      };
    } catch (error: unknown) {
      if (!isExpiredSessionError(error, existingSessionId)) throw error;
    }
  }
  const session = await createBackendSession();
  return {
    sessionId: session.id,
    history: sanitizeBackendHistory(await getBackendHistory(session.id)),
    isNew: true,
  };
}
function isExpiredSessionError(error: unknown, sessionId: string): boolean {
  if (!(error instanceof ApiClientError)) return false;
  return (
    error.status === 404 ||
    error.status === 410 ||
    (error.status === 500 && error.message === `Session ${sessionId} was not found or has expired`)
  );
}
export async function POST(): Promise<NextResponse> {
  try {
    const session = await createBackendSession();
    return setSessionCookie(NextResponse.json({}), session.id);
  } catch (error: unknown) {
    return jsonError(error);
  }
}
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const sessionId = requireSessionId(request.headers.get('cookie'), readSessionId);
  if (sessionId instanceof NextResponse) return sessionId;
  try {
    await deleteBackendSession(sessionId);
    const response = new NextResponse(null, { status: 204 });
    response.cookies.delete('copilot_session');
    return response;
  } catch (error: unknown) {
    return jsonError(error);
  }
}
