export interface ActiveTurnLockPort {
  acquire(key: string, owner: string, ttlSeconds: number): Promise<boolean>;
  release(key: string, owner: string): Promise<void>;
}
