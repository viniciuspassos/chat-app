import type { ConversationExchange, ConversationRepositoryPort } from '../domain/types';
export interface RedisListPort {
  lRange(key: string, start: number, stop: number): Promise<string[]>;
  rPush(key: string, value: string): Promise<number>;
  expire(key: string, seconds: number): Promise<boolean>;
}
export class RedisConversationRepository implements ConversationRepositoryPort {
  public constructor(
    private readonly redis: RedisListPort,
    private readonly ttlSeconds = 1_800,
  ) {}
  async list(sessionId: string): Promise<readonly ConversationExchange[]> {
    return (await this.redis.lRange(this.key(sessionId), 0, -1)).map((value) =>
      parseExchange(value, sessionId),
    );
  }
  async append(sessionId: string, exchange: ConversationExchange): Promise<void> {
    const key = this.key(sessionId);
    await this.redis.rPush(key, JSON.stringify(exchange));
    await this.redis.expire(key, this.ttlSeconds);
  }
  private key(sessionId: string): string {
    return `session:${sessionId}:exchanges`;
  }
}
function parseExchange(value: string, sessionId: string): ConversationExchange {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isExchange(parsed)) throw new Error('invalid shape');
    return parsed;
  } catch (error) {
    throw new Error(
      `Stored exchange for session ${sessionId} is invalid: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
}
function isExchange(value: unknown): value is ConversationExchange {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.userMessage === 'string' &&
    Array.isArray(candidate.blocks)
  );
}
