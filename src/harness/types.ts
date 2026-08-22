/**
 * Result of installing crewmate integration files
 */
export interface InstallResult {
  harness: string;
  filesWritten: string[];
}

/**
 * Status of an individual file during an update
 */
export type FileUpdateAction = 'created' | 'updated' | 'unchanged' | 'backed_up_and_updated';

/**
 *
 */
export interface FileUpdateStatus {
  path: string;
  action: FileUpdateAction;
  backupPath?: string;
}

/**
 * Options for updating harness integration files
 */
export interface UpdateOptions {
  force?: boolean;
  dryRun?: boolean;
  backup?: boolean;
}

/**
 * Summary counts for update operations
 */
export interface UpdateSummary {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  backedUp: number;
}

/**
 * Result of updating crewmate integration files
 */
export interface UpdateResult {
  harness: string;
  version: string;
  files: FileUpdateStatus[];
  backedUpFiles: string[];
  summary: UpdateSummary;
  dryRun?: boolean;
}

/**
 * Manifest storing metadata and checksums of installed files
 */
export interface ManifestFileEntry {
  hash: string;
  updatedAt: string;
}

/**
 *
 */
export interface CrewmateManifest {
  version: string;
  harness: string;
  installedAt: string;
  updatedAt: string;
  files: Record<string, ManifestFileEntry>;
}

/**
 * Adapter interface for different AI harnesses
 */
export interface HarnessAdapter {
  name: string;
  description: string;
  install(targetDir: string): Promise<InstallResult>;
  update(targetDir: string, options?: UpdateOptions): Promise<UpdateResult>;
}
