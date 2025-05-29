import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { join } from 'path';
import { RecordingOptions, RecordingResult } from '../types/recording';
import { ensureDir, generateOutputPath } from '../utils/file-utils';
import { logger } from '../utils/logger';
import { FigmaCanvasDetector } from '../utils/canvas-detector';
import { FrameCapture } from '../utils/frame-capture';
import { getResolution } from '../utils/resolution-presets';

export class FigmaRecorder {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private canvasDetector: FigmaCanvasDetector | null = null;
  private frameCapture: FrameCapture | null = null;

  async initialize(): Promise<void> {
    try {
      logger.info('Initializing browser context...');
      
      const userDataDir = join(process.cwd(), '.browser-data');
      await ensureDir(userDataDir);
      
      this.context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        viewport: null,
        args: [
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--no-sandbox'
        ],
        ignoreHTTPSErrors: true,
        bypassCSP: true
      });
      
      logger.success('Browser context initialized');
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

      const outputDir = './recordings';
      await ensureDir(outputDir);

      const resolution = getResolution(
        'custom',
        options.customWidth,
        options.customHeight
      );

      const outputPath = generateOutputPath(outputDir, options.format);
      
      logger.info(`Starting ${options.recordingMode} recording for: ${options.figmaUrl}`);
      logger.info(`Resolution: ${resolution.width}×${resolution.height}`);
      logger.info(`Output path: ${outputPath}`);

      // Create or reuse page
      if (!this.page) {
        this.page = await this.context!.newPage();
      }
      
      // Set viewport for this recording
      await this.page.setViewportSize(resolution);
      
      this.canvasDetector = new FigmaCanvasDetector(this.page);

      // Navigate to Figma prototype
      await this.navigateWithRetry(options.figmaUrl);

      // Wait for canvas if requested
      let canvasInfo;
      if (options.waitForCanvas) {
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
        await this.recordVideo(options, outputPath);
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
          waitUntil: 'domcontentloaded',
          timeout: 60000
        });
        
        // Wait for Figma to load
        await this.page!.waitForTimeout(3000);
        
        // Check if we're on Figma
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
        
        await this.page!.waitForTimeout(2000);
      }
    }
  }

  private async recordVideo(options: RecordingOptions, outputPath: string): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    logger.info('Starting video recording...');
    
    // Get canvas info for clipping
    const canvasInfo = await this.canvasDetector!.detectCanvasInfo();
    
    // Close current page and create video context
    await this.page.close();
    
    const userDataDir = join(process.cwd(), '.browser-data-video');
    await ensureDir(userDataDir);
    
    const videoContext = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      viewport: canvasInfo.bounds ? {
        width: Math.round(canvasInfo.bounds.width),
        height: Math.round(canvasInfo.bounds.height)
      } : { width: 1920, height: 1080 },
      recordVideo: {
        dir: './recordings',
        size: canvasInfo.bounds ? {
          width: Math.round(canvasInfo.bounds.width),
          height: Math.round(canvasInfo.bounds.height)
        } : { width: 1920, height: 1080 }
      },
      args: [
        '--disable-web-security',
        '--no-sandbox'
      ],
      ignoreHTTPSErrors: true,
      bypassCSP: true
    });
    
    const recordingPage = videoContext.pages()[0] || await videoContext.newPage();
    this.page = recordingPage;
    
    // Create new canvas detector
    this.canvasDetector = new FigmaCanvasDetector(this.page);
    
    // Navigate and setup
    await this.navigateWithRetry(options.figmaUrl);
    await this.canvasDetector!.optimizeForRecording();
    await this.canvasDetector!.clickPlayButton();
    await this.canvasDetector!.waitForFlowStart();

    if (options.stopMode === 'manual') {
      logger.info('Recording started. Press Ctrl+C to stop.');
      
      if (options.duration) {
        logger.info(`Will auto-stop after ${options.duration / 1000}s if not stopped manually`);
        await this.page.waitForTimeout(options.duration);
      } else {
        // Wait for manual stop
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
    
    // Stop video recording
    const videoPath = await recordingPage.video()?.path();
    await videoContext.close();
    
    if (videoPath) {
      logger.success(`Video recording completed: ${videoPath}`);
    }
    
    // Restore original context
    this.page = null;
    this.canvasDetector = null;
  }

  private async recordFrames(
    options: RecordingOptions, 
    canvasInfo: any, 
    outputPath: string
  ): Promise<number> {
    if (!this.page) throw new Error('Page not initialized');

    this.frameCapture = new FrameCapture(this.page, './recordings', options.frameRate);
    logger.info('Starting frame-by-frame capture...');

    let frameCount = 0;

    if (options.stopMode === 'manual') {
      logger.info('Frame capture started. Press Ctrl+C to stop.');
      
      // Start capture without duration
      const capturePromise = this.frameCapture.startCapture(canvasInfo);
      
      // Wait for manual stop
      await new Promise(resolve => {
        const stopHandler = () => {
          if (this.frameCapture && this.frameCapture.isActive()) {
            this.frameCapture.stopCapture();
          }
          resolve(undefined);
        };

        process.on('SIGINT', stopHandler);

        if (options.duration) {
          setTimeout(() => {
            if (this.frameCapture && this.frameCapture.isActive()) {
              this.frameCapture.stopCapture();
            }
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

    // Ensure capture is stopped
    if (this.frameCapture && this.frameCapture.isActive()) {
      this.frameCapture.stopCapture();
    }

    // Create video from frames
    if (frameCount > 0 && this.frameCapture) {
      logger.info(`Creating video from ${frameCount} captured frames...`);
      await this.frameCapture.createVideoFromFrames(outputPath);
      logger.success('Video creation completed!');
    } else {
      logger.warn('No frames captured, skipping video creation');
    }

    return frameCount;
  }

  async cleanup(): Promise<void> {
    try {
      if (this.frameCapture) {
        this.frameCapture.stopCapture();
      }
      
      if (this.page) {
        await this.page.close();
        this.page = null;
      }
      
      this.canvasDetector = null;
      this.frameCapture = null;
      
      logger.info('Recording session cleaned up');
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
      logger.info('Browser context closed');
    } catch (error) {
      logger.error('Error closing browser context:', error);
    }
  }
}
