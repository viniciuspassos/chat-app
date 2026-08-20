import type { FileDownload } from '../http/copilot-api.port';
export interface ArtifactSnapshot {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly mediaType: string;
  readonly downloadUrl: string;
}
export interface ArtifactSnapshotPort {
  snapshot(sessionId: string, path: string): Promise<ArtifactSnapshot>;
  download(sessionId: string, artifactId: string): Promise<FileDownload>;
}
