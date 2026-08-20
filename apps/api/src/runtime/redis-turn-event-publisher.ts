import type { SseEvent } from '@chat-app/contracts';
import type { RedisStreamPort } from '../stream/redis-event.sink';
import type { TurnEventPublisherPort } from './turn-event-publisher.port';
export class RedisTurnEventPublisher implements TurnEventPublisherPort {
  public constructor(
    private readonly redis: RedisStreamPort,
    private readonly ttlSeconds = 1_800,
  ) {}
  async publish(turnId: string, event: SseEvent): Promise<void> {
    const key = `turn:${turnId}:events`;
    await this.redis.xAdd(key, '*', { event: event.type, payload: JSON.stringify(event) });
    await this.redis.expire(key, this.ttlSeconds);
  }
}
