import { Page } from 'playwright';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { logger } from './logger.js';
import { CanvasInfo } from '../types/recording.js';

export class FrameCapture {
  private frameCount = 0;
  private isCapturing = false;
  private captureInterval: NodeJS.Timeout | null = null;

  constructor(
    private page: Page,
    private outputDir: string,
    private frameRate: number = 10
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

    const frameInterval = Math.floor(1000 / this.frameRate);
    const startTime = Date.now();

    return new Promise((resolve) => {
      this.captureInterval = setInterval(async () => {
        // Double-check if we should continue capturing
        if (!this.isCapturing) {
          this.cleanup();
          resolve(this.frameCount);
          return;
        }

        // Check if page is still available before trying to capture
        if (this.page.isClosed()) {
          logger.warn('Page was closed, stopping frame capture');
          this.isCapturing = false;
          this.cleanup();
          resolve(this.frameCount);
          return;
        }

        try {
          await this.captureFrame(framesDir, canvasInfo);
          this.frameCount++;
          
          if (this.frameCount % 30 === 0) {
            logger.info(`📸 Captured ${this.frameCount} frames`);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          
          // If page is closed, stop gracefully instead of logging errors
          if (errorMsg.includes('closed') || errorMsg.includes('Target page')) {
            logger.info(`Frame capture stopped - page was closed at frame ${this.frameCount}`);
            this.isCapturing = false;
            this.cleanup();
            resolve(this.frameCount);
            return;
          }
          
          logger.warn(`❌ Frame ${this.frameCount} failed: ${errorMsg}`);
          // Still increment frameCount to maintain sequence continuity - we'll duplicate the last good frame
          this.frameCount++;
          
          // Try to duplicate the last successful frame to maintain sequence
          try {
            await this.duplicateLastFrame(framesDir);
          } catch (dupError) {
            logger.warn('Could not duplicate last frame for gap filling');
          }
        }

        // Check duration after processing (successful capture or error handling)
        if (duration && (Date.now() - startTime) >= (duration * 1000)) {
          this.isCapturing = false;
          this.cleanup();
          resolve(this.frameCount);
          return;
        }
      }, frameInterval);
    });
  }

  private async captureFrame(framesDir: string, canvasInfo: CanvasInfo): Promise<void> {
    if (!this.isCapturing) return;

    // Check if page is still available before attempting screenshot
    if (this.page.isClosed()) {
      this.isCapturing = false; // Stop capturing if page is closed
      throw new Error('Page has been closed');
    }

    const frameNumber = String(this.frameCount).padStart(6, '0');
    const framePath = join(framesDir, `frame_${frameNumber}.png`);
    
    try {
      // Simple approach: screenshot the canvas area or full page
      if (canvasInfo.detected && canvasInfo.bounds) {
        // Screenshot just the canvas area
        await this.page.screenshot({
          path: framePath,
          clip: canvasInfo.bounds,
          type: 'png',
          timeout: 5000,
          animations: 'disabled'
        });
      } else {
        // Fallback: screenshot the first canvas element
        const canvas = this.page.locator('canvas').first();
        const canvasCount = await canvas.count();
        
        if (canvasCount > 0) {
          await canvas.screenshot({
            path: framePath,
            type: 'png',
            timeout: 5000,
            animations: 'disabled'
          });
        } else {
          // Last resort: full page screenshot
          await this.page.screenshot({
            path: framePath,
            type: 'png',
            timeout: 5000,
            fullPage: false
          });
        }
      }
    } catch (error) {
      throw error;
    }
  }

  private async duplicateLastFrame(framesDir: string): Promise<void> {
    if (this.frameCount <= 0) return;
    
    // Find the last successfully captured frame
    const fs = await import('fs/promises');
    const lastFrameNumber = String(this.frameCount - 1).padStart(6, '0');
    const currentFrameNumber = String(this.frameCount).padStart(6, '0');
    
    const lastFramePath = join(framesDir, `frame_${lastFrameNumber}.png`);
    const currentFramePath = join(framesDir, `frame_${currentFrameNumber}.png`);
    
    try {
      // Check if last frame exists before copying
      await fs.access(lastFramePath);
      await fs.copyFile(lastFramePath, currentFramePath);
    } catch (error) {
      // If we can't find a previous frame, just continue - this is a fallback
      throw error;
    }
  }

  stopCapture(): void {
    if (!this.isCapturing) return;
    
    this.isCapturing = false;
    this.cleanup();
    logger.success(`Frame capture stopped - ${this.frameCount} frames captured`);
  }

  private cleanup(): void {
    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }
    this.isCapturing = false;
  }

  getFrameCount(): number {
    return this.frameCount;
  }

  isActive(): boolean {
    return this.isCapturing;
  }
}
