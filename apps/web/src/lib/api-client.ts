type ApiErrorPayload = { message?: string };
export class ApiClientError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export type BackendSession = { id: string };
export type ChatRequest = { turnId: string; message: string };
function getApiUrl(): string {
  return process.env.API_INTERNAL_URL ?? 'http://api:3001';
}
function createHeaders(sessionId?: string, additional?: HeadersInit): Headers {
  const headers = new Headers(additional);
  if (sessionId) headers.set('x-copilot-session-id', sessionId);
  return headers;
}
async function throwForError(response: Response): Promise<void> {
  if (response.ok) return;
  const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;
  throw new ApiClientError(
    response.status,
    payload.message ?? `API request failed (${response.status})`,
  );
}
export async function createBackendSession(): Promise<BackendSession> {
  const response = await fetch(`${getApiUrl()}/sessions`, { method: 'POST' });
  await throwForError(response);
  return (await response.json()) as BackendSession;
}
export async function deleteBackendSession(sessionId: string): Promise<void> {
  const response = await fetch(`${getApiUrl()}/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers: createHeaders(sessionId),
  });
  await throwForError(response);
}
export async function getBackendHistory(sessionId: string): Promise<unknown> {
  const response = await fetch(`${getApiUrl()}/sessions/${encodeURIComponent(sessionId)}/history`, {
    headers: createHeaders(sessionId),
  });
  await throwForError(response);
  return response.json();
}
export async function startBackendChat(sessionId: string, request: ChatRequest): Promise<Response> {
  const response = await fetch(`${getApiUrl()}/sessions/${encodeURIComponent(sessionId)}/turns`, {
    method: 'POST',
    headers: createHeaders(sessionId, {
      'content-type': 'application/json',
      accept: 'text/event-stream',
    }),
    body: JSON.stringify(request),
  });
  await throwForError(response);
  return reconnectBackendChat(sessionId, request.turnId);
}
export async function reconnectBackendChat(
  sessionId: string,
  turnId: string,
  lastEventId?: string,
): Promise<Response> {
  const headers = createHeaders(sessionId, { accept: 'text/event-stream' });
  if (lastEventId) headers.set('last-event-id', lastEventId);
  const response = await fetch(
    `${getApiUrl()}/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/stream`,
    { headers },
  );
  await throwForError(response);
  return response;
}
export async function getBackendFile(sessionId: string, artifactId: string): Promise<Response> {
  const response = await fetch(
    `${getApiUrl()}/sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(artifactId)}`,
    { headers: createHeaders(sessionId) },
  );
  await throwForError(response);
  return response;
}
