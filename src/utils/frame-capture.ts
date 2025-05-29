import { Page } from 'playwright';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { logger } from './logger.js';
import { CanvasInfo } from '../types/recording.js';
import ffmpeg from 'fluent-ffmpeg';

export class FrameCapture {
  private frameCount = 0;
  private isCapturing = false;
  private captureInterval: NodeJS.Timeout | null = null;

  constructor(
    private page: Page,
    private outputDir: string,
    private frameRate: number = 30
  ) {}

  async startCapture(canvasInfo: CanvasInfo, duration?: number): Promise<number> {
    if (this.isCapturing) {
      throw new Error('Frame capture already in progress');
    }

    this.isCapturing = true;
    this.frameCount = 0;

    // Create frames directory
    const framesDir = join(this.outputDir, 'frames');
    await mkdir(framesDir, { recursive: true });

    logger.info(`Starting frame capture at ${this.frameRate}fps...`);

    const frameInterval = 1000 / this.frameRate;
    let startTime = Date.now();

    return new Promise((resolve, reject) => {
      this.captureInterval = setInterval(async () => {
        try {
          await this.captureFrame(framesDir, canvasInfo);
          
          // Check if we should stop based on duration
          if (duration && Date.now() - startTime >= duration) {
            this.stopCapture();
            resolve(this.frameCount);
          }
        } catch (error) {
          logger.error('Error capturing frame:', error);
          this.stopCapture();
          reject(error);
        }
      }, frameInterval);

      // If no duration specified, let it run until manually stopped
      if (!duration) {
        logger.info('Frame capture started. Call stopCapture() to stop.');
      }
    });
  }

  async captureFrame(framesDir: string, canvasInfo: CanvasInfo): Promise<void> {
    let screenshot: Buffer;

    if (canvasInfo.bounds) {
      // Capture only the canvas area
      screenshot = await this.page.screenshot({
        clip: {
          x: canvasInfo.bounds.x,
          y: canvasInfo.bounds.y,
          width: canvasInfo.bounds.width,
          height: canvasInfo.bounds.height
        },
        type: 'png'
      });
    } else {
      // Fallback to full page screenshot
      screenshot = await this.page.screenshot({
        type: 'png',
        fullPage: false
      });
    }

    const frameNumber = String(this.frameCount).padStart(6, '0');
    const framePath = join(framesDir, `frame_${frameNumber}.png`);
    
    await writeFile(framePath, screenshot);
    this.frameCount++;

    if (this.frameCount % (this.frameRate * 5) === 0) {
      logger.info(`Captured ${this.frameCount} frames...`);
    }
  }

  stopCapture(): void {
    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }
    this.isCapturing = false;
    logger.success(`Frame capture completed. Total frames: ${this.frameCount}`);
  }

  async createVideoFromFrames(outputPath: string): Promise<void> {
    logger.info('Creating video from captured frames...');

    const framesDir = join(this.outputDir, 'frames');
    const framePattern = join(framesDir, 'frame_%06d.png');

    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(framePattern)
        .inputFPS(this.frameRate)
        .videoCodec('libx264')
        .outputOptions([
          '-preset medium',
          '-crf 23',
          '-pix_fmt yuv420p',
          '-movflags +faststart' // Optimize for web playback
        ])
        .on('start', (commandLine) => {
          logger.info('FFmpeg process started');
          logger.info(`Command: ${commandLine}`);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            logger.info(`Processing: ${Math.round(progress.percent)}% done`);
          }
        })
        .on('end', () => {
          logger.success(`Video created successfully: ${outputPath}`);
          resolve();
        })
        .on('error', (error) => {
          logger.error('Error creating video from frames:', error.message);
          reject(error);
        })
        .save(outputPath);
    });
  }

  getFrameCount(): number {
    return this.frameCount;
  }

  isActive(): boolean {
    return this.isCapturing;
  }
}
