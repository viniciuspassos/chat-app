import { NextResponse, type NextRequest } from 'next/server';
import { getBackendFile } from '@/lib/api-client';
import { jsonError, requireSessionId } from '@/lib/route-response';
import { readSessionId } from '@/lib/session-cookie';
export const runtime = 'nodejs';
type RouteContext = { params: Promise<{ id: string }> };
function fileHeaders(upstream: Response): Headers {
  const headers = new Headers();
  headers.set('content-type', upstream.headers.get('content-type') ?? 'application/octet-stream');
  headers.set('content-disposition', upstream.headers.get('content-disposition') ?? 'attachment');
  return headers;
}
export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const sessionId = requireSessionId(request.headers.get('cookie'), readSessionId);
  if (sessionId instanceof NextResponse) return sessionId;
  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: 'file id is required' }, { status: 400 });
  try {
    const upstream = await getBackendFile(sessionId, id);
    return new Response(upstream.body, { status: upstream.status, headers: fileHeaders(upstream) });
  } catch (error: unknown) {
    return jsonError(error);
  }
}
