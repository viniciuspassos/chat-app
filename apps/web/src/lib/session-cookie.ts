import type { NextResponse } from 'next/server';
export const sessionCookieName = 'copilot_session';
export function setSessionCookie(response: NextResponse, sessionId: string): NextResponse {
  response.cookies.set(sessionCookieName, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 30,
  });
  return response;
}
export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set(sessionCookieName, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
export function readSessionId(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const value = cookieHeader
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${sessionCookieName}=`));
  return value?.slice(sessionCookieName.length + 1) || null;
}
