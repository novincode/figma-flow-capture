import { Page } from 'playwright';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { logger } from './logger';
import { CanvasInfo, FrameTiming } from '../types/recording';
import ffmpeg from 'fluent-ffmpeg';

export class FrameCapture {
  private frameCount = 0;
  private isCapturing = false;
  private captureInterval: NodeJS.Timeout | null = null;
  private frameTimings: FrameTiming[] = [];
  private captureStartTime = 0;

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
    this.frameTimings = [];
    this.captureStartTime = Date.now();

    // Create frames directory
    const framesDir = join(this.outputDir, 'frames');
    await mkdir(framesDir, { recursive: true });

    logger.info(`Starting frame capture at ${this.frameRate}fps...`);

    const frameInterval = 1000 / this.frameRate;
    let lastCaptureTime = this.captureStartTime;

    return new Promise((resolve, reject) => {
      this.captureInterval = setInterval(async () => {
        try {
          // Check if we should stop capturing
          if (!this.isCapturing) {
            clearInterval(this.captureInterval!);
            this.captureInterval = null;
            resolve(this.frameCount);
            return;
          }

          const currentTime = Date.now();
          const elapsedSinceStart = currentTime - this.captureStartTime;
          const frameDuration = currentTime - lastCaptureTime;

          await this.captureFrame(framesDir, canvasInfo, elapsedSinceStart, frameDuration);
          lastCaptureTime = currentTime;
          
          // Check if we should stop based on duration
          if (duration && elapsedSinceStart >= duration) {
            this.stopCapture();
            resolve(this.frameCount);
          }
        } catch (error) {
          logger.error('Error capturing frame:', error);
          // Don't stop the entire capture for a single frame error
        }
      }, frameInterval);

      // If no duration specified, let it run until manually stopped
      if (!duration) {
        logger.info('Frame capture started. Call stopCapture() to stop.');
      }
    });
  }

  private async captureFrame(framesDir: string, canvasInfo: CanvasInfo, timestamp: number, duration: number): Promise<void> {
    // Skip capture if we're no longer supposed to be capturing
    if (!this.isCapturing) {
      return;
    }

    try {
      let screenshot: Buffer;

      if (canvasInfo.bounds) {
        // Get real-time canvas bounds for accurate capture
        const clip = await this.page.evaluate(() => {
          const canvas = document.querySelector('canvas');
          if (canvas) {
            const rect = canvas.getBoundingClientRect();
            return {
              x: Math.max(0, Math.round(rect.x)),
              y: Math.max(0, Math.round(rect.y)),
              width: Math.min(Math.round(rect.width), window.innerWidth - Math.round(rect.x)),
              height: Math.min(Math.round(rect.height), window.innerHeight - Math.round(rect.y))
            };
          }
          return null;
        });

        if (clip && clip.width > 0 && clip.height > 0) {
          screenshot = await this.page.screenshot({
            clip: clip,
            type: 'png',
            timeout: 500, // Very short timeout to avoid hangs
            animations: 'disabled',
            caret: 'hide'
          });
        } else {
          // Fallback if canvas bounds detection fails
          screenshot = await this.page.screenshot({
            type: 'png',
            fullPage: false,
            timeout: 500,
            animations: 'disabled',
            caret: 'hide'
          });
        }
      } else {
        // Fallback to full page screenshot
        screenshot = await this.page.screenshot({
          type: 'png',
          fullPage: false,
          timeout: 500,
          animations: 'disabled',
          caret: 'hide'
        });
      }

      // Save the frame
      const frameNumber = String(this.frameCount).padStart(6, '0');
      const framePath = join(framesDir, `frame_${frameNumber}.png`);
      
      await writeFile(framePath, screenshot);

      // Store timing information
      this.frameTimings.push({
        frameNumber: this.frameCount,
        timestamp,
        duration
      });

      // Log progress every 5 seconds worth of frames
      if (this.frameCount % (this.frameRate * 5) === 0) {
        logger.info(`Captured ${this.frameCount} frames (${(timestamp / 1000).toFixed(1)}s elapsed)...`);
      }

      this.frameCount++;

    } catch (error) {
      // Skip failed frames to avoid timeout loops
      logger.warn(`Frame ${this.frameCount} skipped due to timeout`);
      
      // Still store timing info to maintain timing accuracy
      this.frameTimings.push({
        frameNumber: this.frameCount,
        timestamp,
        duration
      });
      this.frameCount++;
    }
  }

  stopCapture(): void {
    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }
    this.isCapturing = false;
    
    const totalDuration = this.frameTimings.length > 0 ? 
      (this.frameTimings[this.frameTimings.length - 1].timestamp / 1000).toFixed(1) : '0';
    
    logger.success(`Frame capture completed!`);
    logger.info(`📊 Capture statistics:`);
    logger.info(`   Total frames: ${this.frameCount}`);
    logger.info(`   Duration: ${totalDuration}s`);
    logger.info(`   Average FPS: ${this.frameCount > 0 ? (this.frameCount / parseFloat(totalDuration)).toFixed(1) : '0'}`);
  }

  async createVideoFromFrames(outputPath: string): Promise<void> {
    logger.info('Creating video from captured frames with timing metadata...');

    // Save timing metadata for reference
    const timingPath = join(this.outputDir, 'timing-metadata.json');
    await writeFile(timingPath, JSON.stringify({
      totalFrames: this.frameCount,
      frameTimings: this.frameTimings,
      frameRate: this.frameRate,
      totalDuration: this.frameTimings.length > 0 ? 
        this.frameTimings[this.frameTimings.length - 1].timestamp : 0
    }, null, 2));

    const framesDir = join(this.outputDir, 'frames');
    
    // Create video with the same frame rate as capture
    await this.createVideo(framesDir, outputPath);
  }

  private async createVideo(framesDir: string, outputPath: string): Promise<void> {
    const framePattern = join(framesDir, 'frame_%06d.png');

    logger.info(`🎬 Video settings:`);
    logger.info(`   Frame rate: ${this.frameRate} fps`);
    logger.info(`   Total frames: ${this.frameCount}`);
    logger.info(`   Estimated duration: ${(this.frameCount / this.frameRate).toFixed(1)} seconds`);

    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(framePattern)
        .inputOptions([
          `-r ${this.frameRate}` // Input frame rate
        ])
        .videoCodec('libx264')
        .videoFilters([
          // Ensure width and height are even (required for H.264)
          'scale=ceil(iw/2)*2:ceil(ih/2)*2'
        ])
        .outputOptions([
          '-preset medium',
          '-crf 23',
          '-pix_fmt yuv420p',
          '-movflags +faststart', // Optimize for web playback
          `-r ${this.frameRate}` // Output frame rate
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
