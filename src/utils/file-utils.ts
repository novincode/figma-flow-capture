import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

export function generateOutputPath(outputDir: string, format: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `figma-recording-${timestamp}.${format}`;
  return join(outputDir, filename);
}

export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-z0-9.-]/gi, '_');
}
