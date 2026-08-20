import type { SseEvent } from '@chat-app/contracts';
export interface TurnEventPublisherPort {
  publish(turnId: string, event: SseEvent): Promise<void>;
}
