/**
 * Result of installing crewmate integration files
 */
export interface InstallResult {
  harness: string;
  filesWritten: string[];
}

/**
 * Adapter interface for different AI harnesses
 */
export interface HarnessAdapter {
  name: string;
  description: string;
  install(targetDir: string): Promise<InstallResult>;
}
