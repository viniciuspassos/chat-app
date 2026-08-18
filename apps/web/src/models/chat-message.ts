export type ChatMessageRole = 'user' | 'bot';

export interface ChatMessage {
  body: string;
  id: number;
  role: ChatMessageRole;
}

export function createChatMessage(id: number, role: ChatMessageRole, body: string): ChatMessage {
  return {
    body,
    id,
    role,
  };
}
