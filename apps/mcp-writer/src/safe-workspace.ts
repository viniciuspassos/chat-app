import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_CHUNK_BYTES = 64 * 1024;
export const MAX_LIST_FILES = 2_000;

const STAGING_DIRECTORY = '.copilot-staging';
const deniedDirectories = new Set(['.git', 'node_modules', STAGING_DIRECTORY]);
const privateKeyNames = new Set(['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519']);

export class WorkspaceAccessError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'WorkspaceAccessError';
  }
}

interface JournalEntry {
  readonly path: string;
  readonly previous?: Buffer;
}
interface StagedWrite {
  readonly path: string;
  readonly stagingPath: string;
  nextSequence: number;
  readonly chunks: Map<number, string>;
}
interface TurnJournal {
  readonly entries: Map<string, JournalEntry>;
  readonly stagedWrites: Map<string, StagedWrite>;
}

export class SafeWorkspace {
  private rootPath = '';
  private readonly journals = new Map<string, TurnJournal>();

  public constructor(private readonly configuredRoot: string) {}

  public async initialize(): Promise<void> {
    this.rootPath = await realpath(this.configuredRoot);
  }

  public async listFiles(limit = MAX_LIST_FILES): Promise<string[]> {
    const files: string[] = [];
    await this.collectFiles(this.requiredRoot(), files, limit);
    return files.sort();
  }

  public async readText(relativePath: string): Promise<string> {
    const path = await this.resolveExisting(relativePath);
    const info = await stat(path);
    if (!info.isFile())
      throw new WorkspaceAccessError(
        `Expected file at "${relativePath}", received a non-file path.`,
      );
    if (info.size > MAX_FILE_BYTES)
      throw new WorkspaceAccessError(
        `File "${relativePath}" exceeds the ${MAX_FILE_BYTES}-byte limit.`,
      );
    const content = await readFile(path);
    this.assertText(content, relativePath);
    return content.toString('utf8');
  }

  public async writeText(turnId: string, relativePath: string, content: string): Promise<number> {
    this.assertSize(content, relativePath, MAX_FILE_BYTES);
    const target = await this.resolveWritable(relativePath);
    await this.captureBeforeWrite(turnId, relativePath, target);
    await this.replaceAtomically(target, Buffer.from(content));
    return Buffer.byteLength(content);
  }

  public async beginWrite(turnId: string, relativePath: string): Promise<void> {
    const journal = this.journalFor(turnId);
    if (journal.stagedWrites.has(relativePath))
      throw new WorkspaceAccessError(
        `A staged write already exists for "${relativePath}" in turn "${turnId}".`,
      );
    const stagingPath = this.stagingPath(turnId, relativePath);
    await mkdir(dirname(stagingPath), { recursive: true });
    await writeFile(stagingPath, '');
    journal.stagedWrites.set(relativePath, {
      path: await this.resolveWritable(relativePath),
      stagingPath,
      nextSequence: 0,
      chunks: new Map(),
    });
  }

  public async appendWrite(
    turnId: string,
    relativePath: string,
    sequence: number,
    chunk: string,
  ): Promise<number> {
    this.assertSize(chunk, relativePath, MAX_CHUNK_BYTES);
    const staged = this.stagedWrite(turnId, relativePath);
    const retry = staged.chunks.get(sequence);
    if (retry !== undefined) return this.assertRetry(retry, chunk, sequence);
    if (sequence !== staged.nextSequence)
      throw new WorkspaceAccessError(
        `Chunk ${sequence} for "${relativePath}" is out of order; expected ${staged.nextSequence}.`,
      );
    const currentSize = (await stat(staged.stagingPath)).size;
    if (currentSize + Buffer.byteLength(chunk) > MAX_FILE_BYTES)
      throw new WorkspaceAccessError(
        `File "${relativePath}" exceeds the ${MAX_FILE_BYTES}-byte limit.`,
      );
    const handle = await open(staged.stagingPath, 'a');
    await handle.write(chunk);
    await handle.close();
    staged.chunks.set(sequence, chunk);
    staged.nextSequence += 1;
    return currentSize + Buffer.byteLength(chunk);
  }

  public async commitWrite(turnId: string, relativePath: string): Promise<number> {
    const staged = this.stagedWrite(turnId, relativePath);
    await this.captureBeforeWrite(turnId, relativePath, staged.path);
    const bytes = (await stat(staged.stagingPath)).size;
    await mkdir(dirname(staged.path), { recursive: true });
    await rename(staged.stagingPath, staged.path);
    this.journalFor(turnId).stagedWrites.delete(relativePath);
    return bytes;
  }

  public async abortWrite(turnId: string, relativePath: string): Promise<void> {
    const staged = this.stagedWrite(turnId, relativePath);
    await rm(staged.stagingPath, { force: true });
    this.journalFor(turnId).stagedWrites.delete(relativePath);
  }

  public async commitTurn(turnId: string): Promise<void> {
    await this.finishTurn(turnId, false);
  }

  public async rollbackTurn(turnId: string): Promise<void> {
    await this.finishTurn(turnId, true);
  }

  private async finishTurn(turnId: string, restore: boolean): Promise<void> {
    const journal = this.journals.get(turnId);
    if (!journal) return;
    await Promise.all(
      [...journal.stagedWrites.values()].map(({ stagingPath }) => rm(stagingPath, { force: true })),
    );
    if (restore)
      for (const entry of [...journal.entries.values()].reverse()) await this.restore(entry);
    this.journals.delete(turnId);
    await rm(join(this.requiredRoot(), STAGING_DIRECTORY, this.safeTurnId(turnId)), {
      force: true,
      recursive: true,
    });
  }

  private async restore(entry: JournalEntry): Promise<void> {
    if (entry.previous) return this.replaceAtomically(entry.path, entry.previous);
    await unlink(entry.path).catch((error: unknown) => {
      if (!this.isMissing(error)) throw error;
    });
  }

  private async collectFiles(directory: string, files: string[], limit: number): Promise<void> {
    if (files.length >= limit) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (files.length >= limit || entry.isSymbolicLink() || this.isDeniedName(entry.name))
        continue;
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) await this.collectFiles(fullPath, files, limit);
      else if (entry.isFile() && (await this.isReadableText(fullPath)))
        files.push(relative(this.requiredRoot(), fullPath));
    }
  }

  private async isReadableText(path: string): Promise<boolean> {
    const content = await readFile(path);
    return content.length <= MAX_FILE_BYTES && !content.includes(0);
  }

  private async resolveExisting(relativePath: string): Promise<string> {
    const candidate = this.checkedCandidate(relativePath);
    await this.assertNoSymlinkSegments(candidate, relativePath);
    const resolved = await realpath(candidate);
    this.assertWithinRoot(resolved, relativePath);
    return resolved;
  }

  private async resolveWritable(relativePath: string): Promise<string> {
    const candidate = this.checkedCandidate(relativePath);
    await this.assertNoSymlinkSegments(await this.existingParent(candidate), relativePath);
    return candidate;
  }

  private checkedCandidate(relativePath: string): string {
    this.assertAllowedPath(relativePath);
    const candidate = resolve(this.requiredRoot(), relativePath);
    this.assertWithinRoot(candidate, relativePath);
    return candidate;
  }

  private async existingParent(path: string): Promise<string> {
    let current = dirname(path);
    while (true) {
      try {
        await stat(current);
        return current;
      } catch (error: unknown) {
        if (!this.isMissing(error)) throw error;
        const parent = dirname(current);
        if (parent === current)
          throw new WorkspaceAccessError(`Could not find parent for "${path}".`);
        current = parent;
      }
    }
  }

  private async assertNoSymlinkSegments(path: string, originalPath: string): Promise<void> {
    let current = this.requiredRoot();
    for (const segment of relative(current, path).split(sep).filter(Boolean)) {
      current = join(current, segment);
      try {
        if ((await lstat(current)).isSymbolicLink())
          throw new WorkspaceAccessError(`Path "${originalPath}" contains a symbolic link.`);
      } catch (error: unknown) {
        if (this.isMissing(error)) return;
        throw error;
      }
    }
  }

  private async captureBeforeWrite(
    turnId: string,
    relativePath: string,
    path: string,
  ): Promise<void> {
    const journal = this.journalFor(turnId);
    if (journal.entries.has(relativePath)) return;
    const previous = await readFile(path).catch((error: unknown) => {
      if (this.isMissing(error)) return undefined;
      throw error;
    });
    if (previous) this.assertText(previous, relativePath);
    journal.entries.set(relativePath, { path, previous });
  }

  private async replaceAtomically(path: string, content: Buffer): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
    await writeFile(temporary, content);
    await rename(temporary, path);
  }

  private journalFor(turnId: string): TurnJournal {
    const safeId = this.safeTurnId(turnId);
    const existing = this.journals.get(safeId);
    if (existing) return existing;
    const created = {
      entries: new Map<string, JournalEntry>(),
      stagedWrites: new Map<string, StagedWrite>(),
    };
    this.journals.set(safeId, created);
    return created;
  }

  private stagedWrite(turnId: string, path: string): StagedWrite {
    const staged = this.journalFor(turnId).stagedWrites.get(path);
    if (!staged)
      throw new WorkspaceAccessError(`No staged write exists for "${path}" in turn "${turnId}".`);
    return staged;
  }

  private stagingPath(turnId: string, path: string): string {
    return join(
      this.requiredRoot(),
      STAGING_DIRECTORY,
      this.safeTurnId(turnId),
      createHash('sha256').update(path).digest('hex'),
    );
  }
  private assertRetry(previous: string, chunk: string, sequence: number): number {
    if (previous !== chunk)
      throw new WorkspaceAccessError(`Chunk ${sequence} was retried with different content.`);
    return Buffer.byteLength(chunk);
  }
  private requiredRoot(): string {
    if (!this.rootPath) throw new WorkspaceAccessError('Workspace must be initialized before use.');
    return this.rootPath;
  }
  private safeTurnId(turnId: string): string {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(turnId))
      throw new WorkspaceAccessError(`Turn id "${turnId}" has an invalid shape.`);
    return turnId;
  }
  private assertText(content: Buffer, path: string): void {
    if (content.includes(0))
      throw new WorkspaceAccessError(`File "${path}" is binary and cannot be accessed.`);
  }
  private assertSize(content: string, path: string, limit: number): void {
    if (Buffer.byteLength(content) > limit)
      throw new WorkspaceAccessError(`Content for "${path}" exceeds the ${limit}-byte limit.`);
  }
  private assertAllowedPath(path: string): void {
    if (
      !path ||
      isAbsolute(path) ||
      path
        .split(/[\\/]/)
        .some((part) => !part || part === '.' || part === '..' || this.isDeniedName(part))
    )
      throw new WorkspaceAccessError(`Path "${path}" is outside the allowed workspace shape.`);
  }
  private assertWithinRoot(path: string, original: string): void {
    const root = this.requiredRoot();
    if (path !== root && !path.startsWith(`${root}${sep}`))
      throw new WorkspaceAccessError(`Path "${original}" resolves outside the workspace.`);
  }
  private isDeniedName(name: string): boolean {
    const lower = name.toLowerCase();
    return (
      deniedDirectories.has(name) ||
      (lower.startsWith('.env') && lower !== '.env.example') ||
      privateKeyNames.has(lower) ||
      /\.(pem|ppk|key)$/i.test(name)
    );
  }
  private isMissing(error: unknown): boolean {
    return (
      typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
    );
  }
}
