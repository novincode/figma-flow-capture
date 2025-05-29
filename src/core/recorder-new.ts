import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { join } from 'path';
import { RecordingOptions, RecordingResult } from '../types/recording.js';
import { ensureDir, generateOutputPath } from '../utils/file-utils.js';
import { logger } from '../utils/logger.js';
import { FigmaCanvasDetector } from '../utils/canvas-detector.js';
import { FrameCapture } from '../utils/frame-capture.js';
import { getResolution } from '../utils/resolution-presets.js';

export class FigmaRecorder {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private canvasDetector: FigmaCanvasDetector | null = null;
  private frameCapture: FrameCapture | null = null;

  async initialize(): Promise<void> {
    try {
      logger.info('Initializing persistent browser context...');
      
      // Use persistent context to avoid reloading Figma every time
      const userDataDir = join(process.cwd(), '.browser-data');
      await ensureDir(userDataDir);
      
      this.context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        viewport: null, // Will be set later
        args: [
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-dev-shm-usage',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-extensions',
          '--disable-plugins',
          '--disable-background-networking',
          '--disable-default-apps',
          '--no-first-run',
          '--disable-hang-monitor'
        ],
        ignoreHTTPSErrors: true,
        bypassCSP: true
      });
      
      logger.success('Persistent browser context initialized');
    } catch (error) {
      logger.error('Failed to initialize browser context:', error);
      throw error;
    }
  }

  async record(options: RecordingOptions): Promise<RecordingResult> {
    const startTime = Date.now();
    
    try {
      if (!this.context) {
        await this.initialize();
      }

      const outputDir = options.outputDir || './recordings';
      await ensureDir(outputDir);

      const resolution = getResolution(
        options.quality || 'high',
        options.customWidth,
        options.customHeight
      );

      const outputPath = generateOutputPath(outputDir, options.format || 'webm');
      
      logger.info(`Starting ${options.recordingMode || 'video'} recording for: ${options.url}`);
      logger.info(`Resolution: ${resolution.width}×${resolution.height}`);
      logger.info(`Output path: ${outputPath}`);

      // Create or reuse page
      if (!this.page) {
        this.page = await this.context!.newPage();
      }
      
      // Set viewport for this recording
      await this.page.setViewportSize(resolution);
      
      this.canvasDetector = new FigmaCanvasDetector(this.page);

      // Navigate to Figma prototype with retry logic
      await this.navigateWithRetry(options.url);

      // Wait for canvas if requested
      let canvasInfo;
      if (options.waitForCanvas !== false) {
        canvasInfo = await this.canvasDetector.waitForCanvas();
        if (!canvasInfo.detected) {
          logger.warn('Could not detect canvas, proceeding anyway...');
        }
      }

      // Optimize page for recording
      await this.canvasDetector!.optimizeForRecording();

      // Try to click play button or wait for flow to start
      await this.canvasDetector!.clickPlayButton();
      await this.canvasDetector!.waitForFlowStart();

      // Start recording based on mode
      let frameCount = 0;
      if (options.recordingMode === 'frames') {
        frameCount = await this.recordFrames(options, canvasInfo!, outputPath);
      } else {
        await this.recordVideo(options);
      }

      const duration = Date.now() - startTime;
      logger.success(`Recording completed in ${Math.round(duration / 1000)}s`);

      return {
        success: true,
        outputPath,
        duration,
        frameCount: options.recordingMode === 'frames' ? frameCount : undefined,
        actualResolution: resolution
      };

    } catch (error) {
      logger.error('Recording failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async navigateWithRetry(url: string, maxRetries: number = 3): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`Navigation attempt ${attempt}/${maxRetries}...`);
        
        await this.page!.goto(url, {
          waitUntil: 'domcontentloaded', // Less strict than networkidle
          timeout: 90000 // Increased timeout
        });
        
        // Wait a bit more for Figma to load
        await this.page!.waitForTimeout(3000);
        
        // Check if we're actually on Figma
        const isFigmaPage = await this.page!.evaluate(() => {
          return window.location.hostname.includes('figma.com') || 
                 document.title.includes('Figma') ||
                 document.querySelector('canvas') !== null;
        });
        
        if (isFigmaPage) {
          logger.success('Successfully navigated to Figma prototype');
          return;
        } else {
          throw new Error('Not on a Figma page');
        }
        
      } catch (error) {
        logger.warn(`Navigation attempt ${attempt} failed:`, error);
        
        if (attempt === maxRetries) {
          throw new Error(`Failed to navigate after ${maxRetries} attempts: ${error}`);
        }
        
        // Wait before retry
        await this.page!.waitForTimeout(2000);
      }
    }
  }

  private async setupOptimalViewport(resolution: { width: number; height: number }): Promise<void> {
    try {
      logger.info('Setting up optimal viewport...');
      
      // Add some padding for browser UI
      const browserWidth = resolution.width + 100;
      const browserHeight = resolution.height + 200;

      // Note: Playwright doesn't directly support resizing the browser window,
      // but we can set the viewport which will be used for recording
      logger.info(`Viewport will be set to: ${resolution.width}×${resolution.height}`);
    } catch (error) {
      logger.warn('Could not optimize viewport:', error);
    }
  }

  private async recordVideo(options: RecordingOptions): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    if (options.stopMode === 'manual') {
      logger.info('Recording started. Press Ctrl+C to stop, or use the stop command.');
      
      // Set up keyboard listener for manual stop
      this.setupManualStopControls();
      
      if (options.duration) {
        logger.info(`Will auto-stop after ${options.duration / 1000}s if not stopped manually`);
        await this.page.waitForTimeout(options.duration);
      } else {
        // Wait indefinitely until manual stop
        await new Promise(resolve => {
          process.on('SIGINT', resolve);
        });
      }
    } else {
      // Timer-based recording
      const duration = options.duration || 10000;
      logger.info(`Recording for ${duration / 1000}s...`);
      await this.page.waitForTimeout(duration);
    }
  }

  private async recordFrames(
    options: RecordingOptions, 
    canvasInfo: any, 
    outputPath: string
  ): Promise<number> {
    if (!this.page) throw new Error('Page not initialized');

    const frameRate = options.frameRate || 30;
    this.frameCapture = new FrameCapture(this.page, options.outputDir || './recordings', frameRate);

    let frameCount = 0;

    if (options.stopMode === 'manual') {
      logger.info('Frame capture started. Press Ctrl+C to stop.');
      this.setupManualStopControls();

      // Start capture without duration
      const capturePromise = this.frameCapture.startCapture(canvasInfo);
      
      // Wait for manual stop or optional timeout
      await new Promise(resolve => {
        process.on('SIGINT', () => {
          this.frameCapture?.stopCapture();
          resolve(undefined);
        });

        if (options.duration) {
          setTimeout(() => {
            this.frameCapture?.stopCapture();
            resolve(undefined);
          }, options.duration);
        }
      });

      frameCount = this.frameCapture.getFrameCount();
    } else {
      // Timer-based frame capture
      const duration = options.duration || 10000;
      frameCount = await this.frameCapture.startCapture(canvasInfo, duration);
    }

    // Create video from frames
    if (frameCount > 0) {
      await this.frameCapture.createVideoFromFrames(outputPath);
    }

    return frameCount;
  }

  private setupManualStopControls(): void {
    logger.info('🎬 Recording Controls:');
    logger.info('  • Press Ctrl+C to stop recording');
    logger.info('  • Press Ctrl+P to pause/resume (if supported)');
    
    process.on('SIGINT', () => {
      logger.info('Stopping recording...');
      this.frameCapture?.stopCapture();
    });
  }

  async cleanup(): Promise<void> {
    try {
      this.frameCapture?.stopCapture();
      
      // Don't close the persistent context, just close the page
      if (this.page) {
        await this.page.close();
        this.page = null;
      }
      
      // Keep context alive for reuse
      this.canvasDetector = null;
      this.frameCapture = null;
      
      logger.info('Recording session cleaned up (browser context kept alive)');
    } catch (error) {
      logger.error('Error during cleanup:', error);
    }
  }

  async closeForGood(): Promise<void> {
    try {
      if (this.context) {
        await this.context.close();
        this.context = null;
      }
      logger.info('Browser context fully closed');
    } catch (error) {
      logger.error('Error closing browser context:', error);
    }
  }
}

// Convenience function for quick recording
export async function recordFigmaFlow(options: RecordingOptions): Promise<RecordingResult> {
  const recorder = new FigmaRecorder();
  return await recorder.record(options);
}
