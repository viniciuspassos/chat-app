import type { InternalTurnEvent } from '@chat-app/contracts';
import type { TurnEventSink } from '../domain/types';
export interface RedisStreamPort {
  xAdd(key: string, id: string, values: Record<string, string>): Promise<string>;
  expire(key: string, seconds: number): Promise<boolean>;
}
export class RedisEventSink implements TurnEventSink {
  private sequence = 0;
  public constructor(
    private readonly redis: RedisStreamPort,
    private readonly turnId: string,
    private readonly ttlSeconds = 1_800,
  ) {}
  async publish(event: InternalTurnEvent): Promise<void> {
    this.sequence += 1;
    const key = `turn:${this.turnId}:events`;
    await this.redis.xAdd(key, `${this.sequence}-0`, {
      event: event.type,
      payload: JSON.stringify(event),
    });
    await this.redis.expire(key, this.ttlSeconds);
  }
}
