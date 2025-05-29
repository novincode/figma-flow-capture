import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { RecordingOptions, RecordingResult } from '../types/recording.js';
import { getResolution } from '../utils/resolution-presets.js';
import { FigmaCanvasDetector } from '../utils/canvas-detector.js';
import { FrameCapture } from '../utils/frame-capture.js';
import { logger } from '../utils/logger.js';

export class FigmaRecorder {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private canvasDetector: FigmaCanvasDetector | null = null;
  private frameCapture: FrameCapture | null = null;
  private isRecording = false;
  private static persistentContext: BrowserContext | null = null;

  async startRecording(options: RecordingOptions): Promise<RecordingResult> {
    try {
      logger.info('Starting Figma flow recording...');
      
      // Setup recording environment
      await this.setupBrowser(options);
      await this.setupPage(options);
      
      // Detect and prepare canvas
      if (options.waitForCanvas) {
        const canvasInfo = await this.canvasDetector!.waitForCanvas();
        if (!canvasInfo.detected) {
          throw new Error('Failed to detect Figma canvas');
        }
      }

      // Setup optimal recording environment
      await this.canvasDetector!.optimizeForRecording();
      
      // Auto-start flow if needed
      if (options.stopMode === 'auto-detect') {
        await this.canvasDetector!.clickPlayButton();
        await this.canvasDetector!.waitForFlowStart();
      }

      // Start recording based on mode
      let result: RecordingResult;
      
      if (options.recordingMode === 'frames') {
        result = await this.recordFrames(options);
      } else {
        result = await this.recordVideo(options);
      }

      logger.success('Recording completed successfully!');
      return result;

    } catch (error) {
      logger.error('Recording failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    } finally {
      await this.cleanup();
    }
  }

  private async setupBrowser(options: RecordingOptions): Promise<void> {
    logger.info('Launching browser with persistent context...');
    
    // Use persistent context to avoid reloading Figma every time
    if (!FigmaRecorder.persistentContext) {
      const userDataDir = join(process.cwd(), '.browser-data');
      
      FigmaRecorder.persistentContext = await chromium.launchPersistentContext(userDataDir, {
        headless: false, // Keep visible for monitoring
        viewport: null, // Let us control viewport per page
        args: [
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--disable-dev-shm-usage',
          '--no-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-extensions-except',
          '--disable-extensions',
          '--no-first-run',
          '--disable-default-apps',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding'
        ],
        ignoreHTTPSErrors: true,
        bypassCSP: true,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });
    }
    
    this.context = FigmaRecorder.persistentContext;
  }

  private async setupPage(options: RecordingOptions): Promise<void> {
    const resolution = getResolution(
      options.quality || 'high',
      options.customWidth,
      options.customHeight
    );

    logger.info(`Setting up page with resolution: ${resolution.width}x${resolution.height}`);

    // Check if we already have a page with Figma loaded
    const existingPages = this.context!.pages();
    let figmaPage = existingPages.find(page => 
      page.url().includes('figma.com') && !page.isClosed()
    );

    if (figmaPage) {
      logger.info('Reusing existing Figma page...');
      this.page = figmaPage;
    } else {
      logger.info('Creating new page...');
      this.page = await this.context!.newPage();
    }
    
    // Set viewport
    await this.page.setViewportSize(resolution);
    
    // Setup canvas detector
    this.canvasDetector = new FigmaCanvasDetector(this.page);
    
    // Navigate to Figma URL only if not already there
    const currentUrl = this.page.url();
    const targetUrl = options.url;
    
    if (!currentUrl.includes('figma.com') || currentUrl !== targetUrl) {
      logger.info('Navigating to Figma prototype...');
      
      try {
        // Try with different wait strategies
        await this.page.goto(targetUrl, { 
          waitUntil: 'domcontentloaded',
          timeout: 60000 // Increase timeout to 60 seconds
        });
        
        // Wait for additional content to load
        await this.page.waitForLoadState('networkidle', { timeout: 30000 });
        
      } catch (error) {
        logger.warn('Initial navigation failed, trying with load state...');
        
        try {
          await this.page.goto(targetUrl, { 
            waitUntil: 'load',
            timeout: 60000
          });
        } catch (retryError) {
          logger.warn('Standard navigation failed, trying minimal approach...');
          
          // Last attempt with minimal waiting
          await this.page.goto(targetUrl, { timeout: 60000 });
        }
      }
    } else {
      logger.info('Already on correct Figma page, skipping navigation...');
    }
    
    // Wait a moment for page to settle
    await this.page.waitForTimeout(3000);
    
    // Check if page loaded successfully
    const title = await this.page.title();
    if (title.includes('Figma')) {
      logger.success('Figma page loaded successfully!');
    } else {
      logger.warn('Page may not have loaded completely, but proceeding...');
    }
  }

  private async recordFrames(options: RecordingOptions): Promise<RecordingResult> {
    logger.info('Starting frame-by-frame recording...');
    
    const outputDir = options.outputDir || './recordings';
    await mkdir(outputDir, { recursive: true });

    // Get canvas info for precise capture
    const canvasInfo = await this.canvasDetector!.detectCanvasInfo();
    
    this.frameCapture = new FrameCapture(
      this.page!,
      outputDir,
      options.frameRate || 30
    );

    let frameCount = 0;
    this.isRecording = true;

    if (options.stopMode === 'timer' && options.duration) {
      // Timer-based recording
      frameCount = await this.frameCapture.startCapture(canvasInfo, options.duration);
    } else if (options.stopMode === 'manual') {
      // Manual stop recording
      logger.info('Recording started. Press Ctrl+C or close the browser to stop...');
      
      // Setup manual stop handlers
      this.setupManualStopHandlers();
      
      // Start capture without duration limit
      await this.frameCapture.startCapture(canvasInfo);
      frameCount = this.frameCapture.getFrameCount();
    } else if (options.stopMode === 'auto-detect') {
      // Auto-detect when flow ends
      frameCount = await this.recordWithAutoDetection(canvasInfo, options);
    }

    // Create video from frames
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = join(outputDir, `figma-flow-${timestamp}.${options.format || 'mp4'}`);
    
    await this.frameCapture.createVideoFromFrames(outputPath);

    return {
      success: true,
      outputPath,
      frameCount,
      actualResolution: getResolution(
        options.quality || 'high',
        options.customWidth,
        options.customHeight
      )
    };
  }

  private async recordVideo(options: RecordingOptions): Promise<RecordingResult> {
    logger.info('Starting video recording...');
    
    const outputDir = options.outputDir || './recordings';
    await mkdir(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = join(outputDir, `figma-flow-${timestamp}.${options.format || 'webm'}`);

    // Get canvas info for precise capture
    const canvasInfo = await this.canvasDetector!.detectCanvasInfo();
    
    this.isRecording = true;
    const startTime = Date.now();
    
    // Start screen recording using screenshots at regular intervals for video mode
    let screenshots: Buffer[] = [];
    let recordingInterval: NodeJS.Timeout;
    
    const captureScreenshot = async () => {
      try {
        let screenshot: Buffer;
        if (canvasInfo.bounds) {
          screenshot = await this.page!.screenshot({
            clip: {
              x: canvasInfo.bounds.x,
              y: canvasInfo.bounds.y,
              width: canvasInfo.bounds.width,
              height: canvasInfo.bounds.height
            },
            type: 'png'
          });
        } else {
          screenshot = await this.page!.screenshot({ type: 'png', fullPage: false });
        }
        screenshots.push(screenshot);
      } catch (error) {
        logger.error('Error capturing screenshot for video:', error);
      }
    };

    // Start capturing screenshots at 30fps for video
    recordingInterval = setInterval(captureScreenshot, 1000 / 30);

    if (options.stopMode === 'timer' && options.duration) {
      await this.page!.waitForTimeout(options.duration);
    } else if (options.stopMode === 'manual') {
      logger.info('Recording started. Press Ctrl+C or close the browser to stop...');
      this.setupManualStopHandlers();
      
      // Wait indefinitely until manual stop
      await new Promise(resolve => {
        const checkInterval = setInterval(() => {
          if (!this.isRecording) {
            clearInterval(checkInterval);
            resolve(undefined);
          }
        }, 1000);
      });
    } else if (options.stopMode === 'auto-detect') {
      await this.waitForFlowCompletion();
    }

    // Stop recording
    clearInterval(recordingInterval);
    
    // Create video from screenshots using our frame capture utility
    if (screenshots.length > 0) {
      const frameCapture = new FrameCapture(this.page!, outputDir, 30);
      
      // Save screenshots as frames
      const framesDir = join(outputDir, 'video-frames');
      await mkdir(framesDir, { recursive: true });
      
      for (let i = 0; i < screenshots.length; i++) {
        const frameNumber = String(i).padStart(6, '0');
        const framePath = join(framesDir, `frame_${frameNumber}.png`);
        await writeFile(framePath, screenshots[i]);
      }
      
      // Create video from frames
      await frameCapture.createVideoFromFrames(outputPath);
    }
    
    const duration = Date.now() - startTime;

    return {
      success: true,
      outputPath,
      duration,
      actualResolution: getResolution(
        options.quality || 'high',
        options.customWidth,
        options.customHeight
      )
    };
  }

  private async waitForFlowCompletion(): Promise<void> {
    logger.info('Monitoring for flow completion...');
    
    const maxWaitTime = 5 * 60 * 1000; // 5 minutes max
    const startTime = Date.now();
    
    while ((Date.now() - startTime) < maxWaitTime && this.isRecording) {
      await this.page!.waitForTimeout(1000);
      
      const isComplete = await this.page!.evaluate(() => {
        // Look for flow completion indicators
        const playButton = document.querySelector('[data-testid="play-button"]');
        const restartButton = document.querySelector('[title*="Restart"], [aria-label*="Restart"]');
        const completionIndicator = document.querySelector('.flow-complete, .prototype-complete');
        
        return !!(playButton || restartButton || completionIndicator);
      });
      
      if (isComplete) {
        logger.info('Flow completion detected!');
        this.isRecording = false;
        break;
      }
    }
  }

  private async recordWithAutoDetection(canvasInfo: any, options: RecordingOptions): Promise<number> {
    // Start frame capture
    await this.frameCapture!.startCapture(canvasInfo);
    
    // Monitor for flow completion indicators
    let isFlowComplete = false;
    const maxRecordingTime = 5 * 60 * 1000; // 5 minutes max
    const startTime = Date.now();

    while (!isFlowComplete && (Date.now() - startTime) < maxRecordingTime) {
      await this.page!.waitForTimeout(1000);
      
      // Check for flow completion indicators
      isFlowComplete = await this.page!.evaluate(() => {
        // Look for end-of-flow indicators
        const playButton = document.querySelector('[data-testid="play-button"]');
        const restartButton = document.querySelector('[title*="Restart"], [aria-label*="Restart"]');
        const completionIndicator = document.querySelector('.flow-complete, .prototype-complete');
        
        return !!(playButton || restartButton || completionIndicator);
      });

      if (isFlowComplete) {
        logger.info('Flow completion detected, stopping recording...');
        break;
      }
    }

    this.frameCapture!.stopCapture();
    return this.frameCapture!.getFrameCount();
  }

  private setupManualStopHandlers(): void {
    // Handle Ctrl+C
    process.on('SIGINT', () => {
      logger.info('Manual stop requested...');
      this.stopRecording();
    });

    // Handle context disconnect
    if (this.context) {
      this.context.on('close', () => {
        this.stopRecording();
      });
    }
  }

  stopRecording(): void {
    if (!this.isRecording) return;
    
    this.isRecording = false;
    if (this.frameCapture) {
      this.frameCapture.stopCapture();
    }
    logger.info('Recording stopped by user.');
  }

  private async cleanup(): Promise<void> {
    if (this.page && !this.page.isClosed()) {
      // Don't close the page, just reset viewport to default
      try {
        await this.page.setViewportSize({ width: 1280, height: 720 });
      } catch (error) {
        // Ignore viewport errors during cleanup
      }
    }
    
    // Don't close the persistent context - keep it for reuse
    this.isRecording = false;
    
    logger.info('Recording session cleaned up (keeping browser open for reuse)');
  }

  // Method to completely close browser (call manually when done)
  static async closeBrowser(): Promise<void> {
    if (FigmaRecorder.persistentContext) {
      await FigmaRecorder.persistentContext.close();
      FigmaRecorder.persistentContext = null;
      logger.info('Browser context closed completely');
    }
  }
}