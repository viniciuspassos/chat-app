import type { ConversationExchange } from '../domain/types';
export interface SessionView {
  readonly id: string;
}
export interface FileDownload {
  readonly body: Uint8Array;
  readonly mediaType: string;
  readonly name: string;
}
export interface CopilotApiPort {
  createSession(): Promise<SessionView>;
  deleteSession(sessionId: string): Promise<void>;
  history(sessionId: string): Promise<readonly ConversationExchange[]>;
  startTurn(sessionId: string, turnId: string, message: string): Promise<void>;
  events(
    sessionId: string,
    turnId: string,
    afterId?: string,
  ): AsyncIterable<{ readonly id: string; readonly type: string; readonly payload: unknown }>;
  file(sessionId: string, fileId: string): Promise<FileDownload>;
}
export const COPILOT_API = Symbol('COPILOT_API');
