import type { ActiveTurnLockPort } from './active-turn-lock.port';
export interface RedisLockPort {
  set(
    key: string,
    value: string,
    options: { readonly EX: number; readonly NX: true },
  ): Promise<string | null>;
  eval(
    script: string,
    options: { readonly keys: readonly string[]; readonly arguments: readonly string[] },
  ): Promise<unknown>;
}
const releaseIfOwnedScript =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";
export class RedisActiveTurnLock implements ActiveTurnLockPort {
  public constructor(private readonly redis: RedisLockPort) {}
  async acquire(key: string, owner: string, ttlSeconds: number): Promise<boolean> {
    return (await this.redis.set(key, owner, { EX: ttlSeconds, NX: true })) === 'OK';
  }
  async release(key: string, owner: string): Promise<void> {
    await this.redis.eval(releaseIfOwnedScript, { keys: [key], arguments: [owner] });
  }
}
