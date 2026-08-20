import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import type { FileDownload } from '../http/copilot-api.port';
import type { ArtifactSnapshot, ArtifactSnapshotPort } from './artifact-snapshot.port';
interface ArtifactMetadata {
  readonly path: string;
  readonly name: string;
  readonly mediaType: string;
}
const mediaTypes: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.tsx': 'text/plain; charset=utf-8',
};
export class FileSystemArtifactStore implements ArtifactSnapshotPort {
  public constructor(
    private readonly workspaceRoot: string,
    private readonly artifactRoot: string,
  ) {}
  async snapshot(sessionId: string, path: string): Promise<ArtifactSnapshot> {
    const source = await this.resolveWorkspaceFile(path);
    const id = randomUUID();
    await mkdir(this.sessionDirectory(sessionId), { recursive: true });
    await writeFile(this.contentPath(sessionId, id), await readFile(source));
    const metadata = this.metadataFor(path);
    await writeFile(this.metadataPath(sessionId, id), JSON.stringify(metadata));
    return {
      id,
      path,
      name: metadata.name,
      mediaType: metadata.mediaType,
      downloadUrl: `/api/files/${id}`,
    };
  }
  async download(sessionId: string, artifactId: string): Promise<FileDownload> {
    this.assertId(sessionId, 'session');
    this.assertId(artifactId, 'artifact');
    const metadata = await this.readMetadata(sessionId, artifactId);
    return {
      body: await readFile(this.contentPath(sessionId, artifactId)),
      mediaType: metadata.mediaType,
      name: metadata.name,
    };
  }
  private async resolveWorkspaceFile(path: string): Promise<string> {
    if (!path || path.includes('\0')) throw new Error(`Artifact path "${path}" is invalid`);
    const workspace = await realpath(this.workspaceRoot);
    const candidate = resolve(workspace, path);
    if (outside(workspace, candidate))
      throw new Error(`Artifact path "${path}" must resolve inside the workspace`);
    const source = await realpath(candidate);
    if (outside(workspace, source) || !(await stat(source)).isFile())
      throw new Error(`Artifact path "${path}" is not a workspace file`);
    return source;
  }
  private metadataFor(path: string): ArtifactMetadata {
    const name = basename(path);
    return {
      path,
      name,
      mediaType: mediaTypes[extname(name).toLowerCase()] ?? 'application/octet-stream',
    };
  }
  private async readMetadata(sessionId: string, artifactId: string): Promise<ArtifactMetadata> {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(this.metadataPath(sessionId, artifactId), 'utf8'),
      );
      if (!isMetadata(parsed)) throw new Error('invalid shape');
      return parsed;
    } catch (error) {
      throw new Error(
        `Artifact ${artifactId} is unavailable for session ${sessionId}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
  private sessionDirectory(sessionId: string): string {
    this.assertId(sessionId, 'session');
    return join(this.artifactRoot, sessionId);
  }
  private contentPath(sessionId: string, id: string): string {
    this.assertId(id, 'artifact');
    return join(this.sessionDirectory(sessionId), `${id}.content`);
  }
  private metadataPath(sessionId: string, id: string): string {
    this.assertId(id, 'artifact');
    return join(this.sessionDirectory(sessionId), `${id}.json`);
  }
  private assertId(value: string, label: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
      throw new Error(`${label} id "${value}" must be a UUID`);
  }
}
function outside(root: string, path: string): boolean {
  const segment = relative(root, path);
  return segment === '' || segment === '..' || segment.startsWith(`..${sep}`);
}
function isMetadata(value: unknown): value is ArtifactMetadata {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.path === 'string' &&
    typeof record.name === 'string' &&
    typeof record.mediaType === 'string'
  );
}
