import { Page } from 'playwright';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { logger } from './logger.js';
import { CanvasInfo } from '../types/recording.js';

/**
 * Handles frame-by-frame capture of Figma canvas for high-quality video generation.
 * Captures screenshots at specified intervals and saves them as PNG files.
 * 
 * Features:
 * - Configurable frame rate (default: 10 FPS)
 * - Custom resolution support with viewport optimization
 * - Smart canvas detection and cropping
 * - Automatic directory structure creation
 * - Frame numbering with zero-padding
 * 
 * @example
 * ```typescript
 * const capture = new FrameCapture(page, './output', 30, 1920, 1080);
 * const frameCount = await capture.startCapture(canvasInfo, 10);
 * console.log(`Captured ${frameCount} frames`);
 * ```
 */
export class FrameCapture {
  /** Current number of captured frames */
  private frameCount = 0;
  
  /** Flag indicating if capture is currently active */
  private isCapturing = false;
  
  /** Timer interval for frame capture */
  private captureInterval: NodeJS.Timeout | null = null;

  /**
   * Creates a new FrameCapture instance.
   * @param page - Playwright page instance containing the Figma canvas
   * @param outputDir - Directory path where frames will be saved
   * @param frameRate - Frames per second for capture (default: 10)
   * @param targetWidth - Custom output width in pixels (optional)
   * @param targetHeight - Custom output height in pixels (optional)
   * @param scaleToFit - Whether to scale content to fit target dimensions (default: false)
   */
  constructor(
    private page: Page,
    private outputDir: string,
    private frameRate: number = 10,
    private targetWidth?: number,
    private targetHeight?: number,
    private scaleToFit: boolean = false
  ) {}

  /**
   * Starts frame-by-frame capture of the Figma canvas.
   * Creates output directory structure and begins capturing frames at the specified rate.
   * 
   * @param canvasInfo - Information about the detected canvas element
   * @param duration - Optional capture duration in seconds (infinite if not specified)
   * @returns Promise that resolves to the total number of captured frames
   * @throws {Error} If capture is already in progress
   */
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

  /**
   * Captures a single frame from the Figma canvas.
   * Handles both custom resolution and auto-sizing scenarios.
   * Uses smart viewport sizing for custom dimensions.
   * 
   * @param framesDir - Directory where the frame image will be saved
   * @param canvasInfo - Information about the detected canvas element
   * @throws {Error} If page is closed or screenshot fails
   * @private
   */
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
      // For custom target dimensions, we need a smarter approach
      if (this.targetWidth && this.targetHeight) {
        // Get the current viewport size and canvas position
        const viewportSize = this.page.viewportSize();
        
        if (viewportSize && viewportSize.width === this.targetWidth && viewportSize.height === this.targetHeight) {
          // Perfect! Viewport matches our target, capture the whole viewport
          await this.page.screenshot({
            path: framePath,
            type: 'png',
            timeout: 5000,
            animations: 'disabled',
            fullPage: false
          });
        } else if (canvasInfo.detected && canvasInfo.bounds) {
          // Fallback: use canvas bounds but try to scale appropriately
          await this.page.screenshot({
            path: framePath,
            clip: canvasInfo.bounds,
            type: 'png',
            timeout: 5000,
            animations: 'disabled'
          });
        } else {
          // Last fallback: capture viewport area
          await this.page.screenshot({
            path: framePath,
            type: 'png',
            timeout: 5000,
            animations: 'disabled',
            fullPage: false
          });
        }
      } else {
        // Original logic for auto-sizing - use detected canvas bounds
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
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Duplicates the last successfully captured frame to fill gaps.
   * Used when frame capture fails to maintain sequence continuity.
   * 
   * @param framesDir - Directory containing the frame images
   * @throws {Error} If no previous frame exists or copy operation fails
   * @private
   */
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

  /**
   * Stops the active frame capture process.
   * Cleans up timers and logs the final frame count.
   */
  stopCapture(): void {
    if (!this.isCapturing) return;
    
    this.isCapturing = false;
    this.cleanup();
    logger.success(`Frame capture stopped - ${this.frameCount} frames captured`);
  }

  /**
   * Cleans up capture resources and timers.
   * @private
   */
  private cleanup(): void {
    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }
    this.isCapturing = false;
  }

  /**
   * Gets the current number of captured frames.
   * @returns The total number of frames captured so far
   */
  getFrameCount(): number {
    return this.frameCount;
  }

  /**
   * Checks if frame capture is currently active.
   * @returns True if capture is in progress, false otherwise
   */
  isActive(): boolean {
    return this.isCapturing;
  }
}
