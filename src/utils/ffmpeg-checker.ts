import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger.js';

const execAsync = promisify(exec);

export async function checkFFmpegAvailability(): Promise<boolean> {
  try {
    const { stdout } = await execAsync('ffmpeg -version');
    const version = stdout.split('\n')[0];
    logger.success(`FFmpeg found: ${version}`);
    return true;
  } catch (error) {
    logger.error('FFmpeg not found. Please install FFmpeg to use frame-by-frame recording.');
    logger.info('Installation instructions:');
    logger.info('  • macOS: brew install ffmpeg');
    logger.info('  • Ubuntu: sudo apt install ffmpeg');
    logger.info('  • Windows: Download from https://ffmpeg.org/download.html');
    return false;
  }
}

export async function getFFmpegInfo(): Promise<{ version: string; codecs: string[] } | null> {
  try {
    const { stdout } = await execAsync('ffmpeg -version');
    const version = stdout.split('\n')[0].replace('ffmpeg version ', '');
    
    const { stdout: codecsOutput } = await execAsync('ffmpeg -codecs 2>/dev/null | grep "encode"');
    const codecs = codecsOutput.split('\n')
      .filter(line => line.includes('libx264') || line.includes('libx265') || line.includes('libvpx'))
      .map(line => line.trim());

    return { version, codecs };
  } catch (error) {
    return null;
  }
}
