import { randomUUID } from 'node:crypto';
import { PublishedAgentTurnError } from '../agent/agent-loop.service';
import type { PersistedContextSummary } from '../context/context-selector.service';
import type { ConversationExchange, ConversationRepositoryPort, LlmMessage } from '../domain/types';
import type { CopilotApiPort, FileDownload, SessionView } from '../http/copilot-api.port';
import type { ActiveTurnLockPort } from './active-turn-lock.port';
import type { ArtifactSnapshotPort } from './artifact-snapshot.port';
import type { TurnEventPublisherPort } from './turn-event-publisher.port';
export interface RuntimeKeyValuePort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { readonly EX: number }): Promise<unknown>;
  del(key: string): Promise<number>;
}
export interface StreamEntry {
  readonly id: string;
  readonly type: string;
  readonly payload: unknown;
}
export interface TurnEventReaderPort {
  read(turnId: string, afterId?: string): Promise<readonly StreamEntry[]>;
}
export interface AgentRunnerPort {
  run(input: {
    readonly turnId: string;
    readonly sessionId: string;
    readonly userMessage: string;
    readonly messages: readonly LlmMessage[];
  }): Promise<ConversationExchange>;
}
export interface AgentRunnerFactoryPort {
  create(turnId: string): AgentRunnerPort;
}
export interface ContextSelectorPort {
  select(
    exchanges: readonly ConversationExchange[],
    systemPrompt: string,
    previousSummary?: PersistedContextSummary,
  ): Promise<{
    readonly messages: readonly LlmMessage[];
    readonly summary?: PersistedContextSummary;
  }>;
}
type TurnState = 'running' | 'done' | 'failed';
export class RuntimeCopilotApi implements CopilotApiPort {
  public constructor(
    private readonly keys: RuntimeKeyValuePort,
    private readonly exchanges: ConversationRepositoryPort,
    private readonly eventsReader: TurnEventReaderPort,
    private readonly runners: AgentRunnerFactoryPort,
    private readonly lock: ActiveTurnLockPort,
    private readonly context: ContextSelectorPort,
    private readonly artifacts: ArtifactSnapshotPort,
    private readonly eventPublisher: TurnEventPublisherPort,
    private readonly sessionTtlSeconds = 1_800,
    private readonly systemPrompt = '',
  ) {}
  async createSession(): Promise<SessionView> {
    const id = randomUUID();
    await this.keys.set(this.sessionKey(id), 'active', { EX: this.sessionTtlSeconds });
    return { id };
  }
  async deleteSession(sessionId: string): Promise<void> {
    await Promise.all([
      this.keys.del(this.sessionKey(sessionId)),
      this.keys.del(this.turnKey(sessionId)),
      this.keys.del(this.summaryKey(sessionId)),
    ]);
  }
  async history(sessionId: string): Promise<readonly ConversationExchange[]> {
    await this.requireSession(sessionId);
    return this.exchanges.list(sessionId);
  }
  async startTurn(sessionId: string, turnId: string, message: string): Promise<void> {
    await this.requireSession(sessionId);
    if (!(await this.lock.acquire(this.turnKey(sessionId), turnId, this.sessionTtlSeconds)))
      throw new Error(`Session ${sessionId} already has an active turn`);
    await this.keys.set(this.stateKey(turnId), JSON.stringify({ state: 'running' }), {
      EX: this.sessionTtlSeconds,
    });
    void this.runInBackground(sessionId, turnId, message);
  }
  async *events(sessionId: string, turnId: string, afterId?: string): AsyncIterable<StreamEntry> {
    await this.requireSession(sessionId);
    let cursor = afterId;
    while (true) {
      for (const event of await this.eventsReader.read(turnId, cursor)) {
        cursor = event.id;
        yield event;
      }
      if (await this.terminal(turnId)) return;
      await delay(100);
    }
  }
  async file(sessionId: string, fileId: string): Promise<FileDownload> {
    await this.requireSession(sessionId);
    return this.artifacts.download(sessionId, fileId);
  }
  private async runInBackground(sessionId: string, turnId: string, message: string): Promise<void> {
    try {
      const history = await this.exchanges.list(sessionId);
      const selected = await this.context.select(
        history,
        this.systemPrompt,
        await this.summary(sessionId),
      );
      const exchange = await this.runners
        .create(turnId)
        .run({ turnId, sessionId, userMessage: message, messages: selected.messages });
      await this.exchanges.append(sessionId, exchange);
      if (selected.summary)
        await this.keys.set(this.summaryKey(sessionId), JSON.stringify(selected.summary), {
          EX: this.sessionTtlSeconds,
        });
      await this.eventPublisher.publish(turnId, {
        type: 'done',
        turnId,
        exchangeIndex: history.length,
      });
      await this.setState(turnId, 'done');
    } catch (error) {
      if (!(error instanceof PublishedAgentTurnError))
        await this.eventPublisher.publish(turnId, {
          type: 'error',
          code: 'runtime_failed',
          message: error instanceof Error ? error.message : 'Turn failed',
        });
      await this.setState(turnId, 'failed');
    } finally {
      await this.lock.release(this.turnKey(sessionId), turnId);
    }
  }
  private async requireSession(id: string): Promise<void> {
    if ((await this.keys.get(this.sessionKey(id))) === null)
      throw new Error(`Session ${id} was not found or has expired`);
  }
  private async terminal(id: string): Promise<boolean> {
    const value = await this.keys.get(this.stateKey(id));
    return value === null || stateFrom(value) !== 'running';
  }
  private async setState(id: string, state: TurnState): Promise<void> {
    await this.keys.set(this.stateKey(id), JSON.stringify({ state }), {
      EX: this.sessionTtlSeconds,
    });
  }
  private async summary(id: string): Promise<PersistedContextSummary | undefined> {
    const value = await this.keys.get(this.summaryKey(id));
    return value ? (JSON.parse(value) as PersistedContextSummary) : undefined;
  }
  private sessionKey(id: string): string {
    return `session:${id}`;
  }
  private turnKey(id: string): string {
    return `session:${id}:active-turn`;
  }
  private stateKey(id: string): string {
    return `turn:${id}:state`;
  }
  private summaryKey(id: string): string {
    return `session:${id}:summary`;
  }
}
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
function stateFrom(value: string): TurnState {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null)
    throw new Error('Stored turn state must be an object');
  const state = (parsed as Record<string, unknown>).state;
  if (state === 'running' || state === 'done' || state === 'failed') return state;
  throw new Error('Stored turn state is invalid');
}
