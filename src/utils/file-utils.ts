import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Ensures a directory exists, creating it recursively if needed.
 * Safe to call multiple times on the same directory.
 * 
 * @param dirPath - The directory path to ensure exists
 * 
 * @example
 * ```typescript
 * ensureDir('./recordings/session-1');
 * // Directory is now guaranteed to exist
 * ```
 */
export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Generates a timestamped output file path for recordings.
 * Creates unique filenames to prevent overwrites.
 * 
 * @param outputDir - The directory where the file will be saved
 * @param format - The file format extension (e.g., 'mp4', 'webm')
 * @returns Complete file path with timestamp
 * 
 * @example
 * ```typescript
 * const path = generateOutputPath('./recordings', 'mp4');
 * // Returns: './recordings/figma-recording-2024-01-15T10-30-45-123Z.mp4'
 * ```
 */
export function generateOutputPath(outputDir: string, format: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `figma-recording-${timestamp}.${format}`;
  return join(outputDir, filename);
}

/**
 * Sanitizes a filename by replacing invalid characters with underscores.
 * Ensures cross-platform compatibility for file names.
 * 
 * @param filename - The filename to sanitize
 * @returns Sanitized filename safe for all operating systems
 * 
 * @example
 * ```typescript
 * const safe = sanitizeFilename('My Design: v2.1');
 * // Returns: 'My_Design__v2_1'
 * ```
 */
export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-z0-9.-]/gi, '_');
}
