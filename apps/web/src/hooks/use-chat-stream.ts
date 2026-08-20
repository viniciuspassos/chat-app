'use client';

import { sseEventSchema, type SseEvent, type ToolStatus } from '@chat-app/contracts';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { BrowserHistory } from '@/lib/browser-chat';
import { readSseStream, type ParsedSseEvent } from '@/lib/sse';

export type ChatTool = {
  id: string;
  name: string;
  server: 'search' | 'writer';
  status: ToolStatus;
};
export type ChatFile = { id: string; path: string; downloadUrl: string };
export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  tools: ChatTool[];
  files: ChatFile[];
  error?: string;
};
export type ChatState = {
  messages: ChatMessage[];
  activeTurnId?: string;
  lastEventId?: string;
  isReady: boolean;
  error?: string;
  retryMessage?: string;
  failedTurnId?: string;
};
type ChatAction =
  | { type: 'bootstrap_loaded'; history: BrowserHistory }
  | { type: 'session_error'; message: string }
  | { type: 'turn_started'; turnId: string; text: string; replacesTurnId?: string }
  | { type: 'turn_resumed'; turnId: string; text: string; lastEventId?: string }
  | { type: 'event'; event: SseEvent; eventId?: string }
  | { type: 'turn_error'; message: string };
type PendingTurn = { turnId: string; message: string; lastEventId?: string };
const pendingTurnStorageKey = 'codebase-copilot.pending-turn';
export const initialChatState: ChatState = { messages: [], isReady: false };
function assistantMessage(turnId: string): ChatMessage {
  return { id: `${turnId}:assistant`, role: 'assistant', text: '', tools: [], files: [] };
}
function updateActiveAssistant(
  messages: ChatMessage[],
  turnId: string | undefined,
  updater: (message: ChatMessage) => ChatMessage,
): ChatMessage[] {
  if (!turnId) return messages;
  const assistantId = `${turnId}:assistant`;
  return messages.map((message) => (message.id === assistantId ? updater(message) : message));
}
function mergeTool(tools: ChatTool[], tool: ChatTool): ChatTool[] {
  const index = tools.findIndex((candidate) => candidate.id === tool.id);
  return index < 0
    ? [...tools, tool]
    : tools.map((candidate, candidateIndex) => (candidateIndex === index ? tool : candidate));
}
function mergeFile(files: ChatFile[], file: ChatFile): ChatFile[] {
  return files.some((candidate) => candidate.id === file.id) ? files : [...files, file];
}
function historyMessages(history: BrowserHistory): ChatMessage[] {
  return history.exchanges.flatMap((exchange) => [
    {
      id: `${exchange.id}:user`,
      role: 'user' as const,
      text: exchange.userMessage,
      tools: [],
      files: [],
    },
    {
      id: `${exchange.id}:assistant`,
      role: 'assistant' as const,
      text: exchange.assistant.text,
      tools: exchange.assistant.tools,
      files: exchange.assistant.files,
    },
  ]);
}
function activeMessage(state: ChatState): string | undefined {
  return state.activeTurnId
    ? state.messages.find((message) => message.id === `${state.activeTurnId}:user`)?.text
    : undefined;
}
export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  if (action.type === 'bootstrap_loaded')
    return { ...state, messages: historyMessages(action.history), isReady: true, error: undefined };
  if (action.type === 'session_error') return { ...state, error: action.message };
  if (action.type === 'turn_started') {
    const messages = action.replacesTurnId
      ? state.messages.filter((message) => !message.id.startsWith(`${action.replacesTurnId}:`))
      : state.messages;
    const user: ChatMessage = {
      id: `${action.turnId}:user`,
      role: 'user',
      text: action.text,
      tools: [],
      files: [],
    };
    return {
      ...state,
      messages: [...messages, user, assistantMessage(action.turnId)],
      activeTurnId: action.turnId,
      lastEventId: undefined,
      error: undefined,
      retryMessage: undefined,
      failedTurnId: undefined,
    };
  }
  if (action.type === 'turn_resumed') {
    const hasTurn = state.messages.some((message) => message.id === `${action.turnId}:user`);
    const messages = hasTurn
      ? state.messages
      : [
          ...state.messages,
          {
            id: `${action.turnId}:user`,
            role: 'user' as const,
            text: action.text,
            tools: [],
            files: [],
          },
          assistantMessage(action.turnId),
        ];
    return { ...state, messages, activeTurnId: action.turnId, lastEventId: action.lastEventId };
  }
  if (action.type === 'turn_error')
    return {
      ...state,
      activeTurnId: undefined,
      error: action.message,
      retryMessage: activeMessage(state),
      failedTurnId: state.activeTurnId,
      messages: updateActiveAssistant(state.messages, state.activeTurnId, (message) => ({
        ...message,
        error: action.message,
      })),
    };
  if (action.type !== 'event') return state;
  const event = action.event;
  const withEventId = action.eventId ? { ...state, lastEventId: action.eventId } : state;
  if (event.type === 'text')
    return {
      ...withEventId,
      messages: updateActiveAssistant(state.messages, state.activeTurnId, (message) => ({
        ...message,
        text: message.text + event.delta,
      })),
    };
  if (event.type === 'tool') {
    const tool: ChatTool = {
      id: event.toolUseId,
      name: event.name,
      server: event.server,
      status: event.status,
    };
    return {
      ...withEventId,
      messages: updateActiveAssistant(state.messages, state.activeTurnId, (message) => ({
        ...message,
        tools: mergeTool(message.tools, tool),
      })),
    };
  }
  if (event.type === 'file') {
    const file: ChatFile = {
      id: event.artifactId,
      path: event.path,
      downloadUrl: event.downloadUrl,
    };
    return {
      ...withEventId,
      messages: updateActiveAssistant(state.messages, state.activeTurnId, (message) => ({
        ...message,
        files: mergeFile(message.files, file),
      })),
    };
  }
  if (event.type === 'done') return { ...withEventId, activeTurnId: undefined };
  if (event.type === 'error')
    return {
      ...withEventId,
      activeTurnId: undefined,
      error: event.message,
      retryMessage: activeMessage(state),
      failedTurnId: state.activeTurnId,
      messages: updateActiveAssistant(state.messages, state.activeTurnId, (message) => ({
        ...message,
        error: event.message,
      })),
    };
  return withEventId;
}
export function parseChatEvent(event: ParsedSseEvent): SseEvent | null {
  try {
    const value: unknown = JSON.parse(event.data);
    const withType =
      typeof value === 'object' && value !== null && !('type' in value) && event.event !== 'message'
        ? { ...value, type: event.event }
        : value;
    const parsed = sseEventSchema.safeParse(withType);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function newTurnId(): string {
  return crypto.randomUUID();
}
async function responseError(response: Response, fallback: string): Promise<Error> {
  const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
  return new Error(typeof payload.error === 'string' ? payload.error : fallback);
}
async function openTurn(turnId: string, message: string): Promise<Response> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ turnId, message }),
  });
  if (!response.ok) throw await responseError(response, 'Unable to send the message.');
  return response;
}
async function reconnectTurn(turnId: string, lastEventId?: string): Promise<Response> {
  const response = await fetch(`/api/chat/turns/${encodeURIComponent(turnId)}`, {
    headers: lastEventId ? { 'last-event-id': lastEventId } : undefined,
  });
  if (!response.ok) throw await responseError(response, 'The connection was interrupted.');
  return response;
}
async function bootstrapSession(): Promise<BrowserHistory> {
  const response = await fetch('/api/session');
  if (!response.ok) throw await responseError(response, 'Unable to start the session.');
  const payload: unknown = await response.json();
  return typeof payload === 'object' &&
    payload !== null &&
    'exchanges' in payload &&
    Array.isArray(payload.exchanges)
    ? (payload as BrowserHistory)
    : { exchanges: [] };
}
function readPendingTurn(): PendingTurn | null {
  try {
    const raw = window.sessionStorage.getItem(pendingTurnStorageKey);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const pending = value as Partial<PendingTurn>;
    return typeof pending.turnId === 'string' && typeof pending.message === 'string'
      ? { turnId: pending.turnId, message: pending.message, lastEventId: pending.lastEventId }
      : null;
  } catch {
    return null;
  }
}
function persistPendingTurn(state: ChatState): void {
  try {
    if (!state.isReady) return;
    if (!state.activeTurnId) return window.sessionStorage.removeItem(pendingTurnStorageKey);
    const message = activeMessage(state);
    if (!message) return;
    window.sessionStorage.setItem(
      pendingTurnStorageKey,
      JSON.stringify({ turnId: state.activeTurnId, message, lastEventId: state.lastEventId }),
    );
  } catch {
    /* Storage is optional. */
  }
}
function clearPendingTurn(): void {
  try {
    window.sessionStorage.removeItem(pendingTurnStorageKey);
  } catch {
    /* Storage is optional. */
  }
}
function historyContainsTurn(history: BrowserHistory, turnId: string): boolean {
  return history.exchanges.some((exchange) => exchange.id === turnId);
}
export function useChatStream(): {
  state: ChatState;
  sendMessage: (message: string) => Promise<void>;
  retryLastMessage: () => Promise<void>;
} {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const latestState = useRef(state);
  const latestEventId = useRef<string | undefined>(undefined);
  useEffect(() => {
    latestState.current = state;
    latestEventId.current = state.lastEventId;
    persistPendingTurn(state);
  }, [state]);
  const streamTurn = useCallback(
    async (turnId: string, message: string, isNew: boolean): Promise<void> => {
      let reconnectAttempt = 0;
      let firstRequest = isNew;
      while (reconnectAttempt <= 2) {
        try {
          const response = firstRequest
            ? await openTurn(turnId, message)
            : await reconnectTurn(turnId, latestEventId.current);
          firstRequest = false;
          let finished = false;
          await readSseStream(response, (sseEvent) => {
            const event = parseChatEvent(sseEvent);
            if (!event) return;
            if (sseEvent.id) latestEventId.current = sseEvent.id;
            if (event.type === 'done' || event.type === 'error') finished = true;
            dispatch({ type: 'event', event, eventId: sseEvent.id });
          });
          if (finished) return;
          throw new Error('The connection was interrupted before the response completed.');
        } catch (error: unknown) {
          reconnectAttempt += 1;
          if (reconnectAttempt > 2)
            dispatch({
              type: 'turn_error',
              message: error instanceof Error ? error.message : 'The response failed.',
            });
        }
      }
    },
    [],
  );
  useEffect(() => {
    let active = true;
    void bootstrapSession()
      .then((history) => {
        if (!active) return;
        dispatch({ type: 'bootstrap_loaded', history });
        const pending = readPendingTurn();
        if (!pending) return;
        if (historyContainsTurn(history, pending.turnId)) {
          clearPendingTurn();
          return;
        }
        latestEventId.current = pending.lastEventId;
        dispatch({
          type: 'turn_resumed',
          turnId: pending.turnId,
          text: pending.message,
          lastEventId: pending.lastEventId,
        });
        void streamTurn(pending.turnId, pending.message, false);
      })
      .catch((error: unknown) => {
        if (active)
          dispatch({
            type: 'session_error',
            message: error instanceof Error ? error.message : 'The session failed.',
          });
      });
    return () => {
      active = false;
    };
  }, [streamTurn]);
  const sendMessage = useCallback(
    async (message: string): Promise<void> => {
      const normalizedMessage = message.trim();
      if (!normalizedMessage || latestState.current.activeTurnId || !latestState.current.isReady)
        return;
      const turnId = newTurnId();
      latestEventId.current = undefined;
      dispatch({ type: 'turn_started', turnId, text: normalizedMessage });
      await streamTurn(turnId, normalizedMessage, true);
    },
    [streamTurn],
  );
  const retryLastMessage = useCallback(async (): Promise<void> => {
    const { activeTurnId, failedTurnId, retryMessage } = latestState.current;
    if (activeTurnId || !retryMessage) return;
    const turnId = newTurnId();
    latestEventId.current = undefined;
    dispatch({ type: 'turn_started', turnId, text: retryMessage, replacesTurnId: failedTurnId });
    await streamTurn(turnId, retryMessage, true);
  }, [streamTurn]);
  return { state, sendMessage, retryLastMessage };
}
