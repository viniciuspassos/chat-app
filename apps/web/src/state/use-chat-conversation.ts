import { useCallback, useReducer, type Dispatch } from 'react';
import { createChatMessage, type ChatMessage } from '../models/chat-message';
import type { ChatApi } from '../services/chat-api';
import { getSafeChatError } from '../components/chat-box-helpers';

export interface ChatConversationState {
  errorMessage: string | null;
  isSending: boolean;
  messages: ChatMessage[];
  nextMessageId: number;
}

export const INITIAL_CHAT_CONVERSATION: ChatConversationState = {
  errorMessage: null,
  isSending: false,
  messages: [],
  nextMessageId: 1,
};

export type ChatConversationAction =
  | { body: string; type: 'requestStarted' }
  | { body: string; type: 'requestSucceeded' }
  | { message: string; type: 'requestFailed' };

function beginChatRequest(state: ChatConversationState, body: string): ChatConversationState {
  const userMessage = createChatMessage(state.nextMessageId, 'user', body);
  return {
    ...state,
    errorMessage: null,
    isSending: true,
    messages: [...state.messages, userMessage],
    nextMessageId: state.nextMessageId + 1,
  };
}

function finishChatRequest(state: ChatConversationState, body: string): ChatConversationState {
  const botMessage = createChatMessage(state.nextMessageId, 'bot', body);
  return {
    ...state,
    isSending: false,
    messages: [...state.messages, botMessage],
    nextMessageId: state.nextMessageId + 1,
  };
}

function failChatRequest(state: ChatConversationState, message: string): ChatConversationState {
  return {
    ...state,
    errorMessage: message,
    isSending: false,
  };
}

export function chatConversationReducer(
  state: ChatConversationState,
  action: ChatConversationAction,
): ChatConversationState {
  if (action.type === 'requestStarted') return beginChatRequest(state, action.body);
  if (action.type === 'requestSucceeded') return finishChatRequest(state, action.body);
  return failChatRequest(state, action.message);
}

async function sendChatMessage(
  chatApi: ChatApi,
  message: string,
  dispatch: Dispatch<ChatConversationAction>,
): Promise<boolean> {
  dispatch({ body: message, type: 'requestStarted' });
  try {
    const response = await chatApi.sendMessage(message);
    dispatch({ body: response.reply, type: 'requestSucceeded' });
    return true;
  } catch (error: unknown) {
    dispatch({ message: getSafeChatError(error), type: 'requestFailed' });
    return false;
  }
}

export function useChatConversation(chatApi: ChatApi) {
  const [conversation, dispatch] = useReducer(chatConversationReducer, INITIAL_CHAT_CONVERSATION);
  const sendMessage = useCallback(
    (message: string) => sendChatMessage(chatApi, message, dispatch),
    [chatApi],
  );
  return { ...conversation, sendMessage };
}
