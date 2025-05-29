import { firefox, Browser, Page } from 'playwright';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import { FrameCapture } from '../utils/frame-capture.js';
import { VideoCapture } from '../utils/video-capture.js';
import { convertFramesToVideo } from '../utils/ffmpeg-converter.js';
import { RecordingOptions, RecordingResult, CanvasInfo } from '../types/recording.js';

export class FigmaRecorder {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private frameCapture: FrameCapture | null = null;
  private videoCapture: VideoCapture | null = null;
  private static sharedBrowser: Browser | null = null;
  private static browserRefCount = 0;
  private static persistentDataDir: string = '/tmp/figma-recorder-firefox';

  async initialize(): Promise<void> {
    logger.info('Initializing Firefox browser...');
    
    // Check if shared browser is still connected
    if (FigmaRecorder.sharedBrowser && !FigmaRecorder.sharedBrowser.isConnected()) {
      logger.info('Shared browser disconnected, creating new instance');
      FigmaRecorder.sharedBrowser = null;
      FigmaRecorder.browserRefCount = 0;
    }
    
    if (!FigmaRecorder.sharedBrowser) {
      // Create persistent user data directory
      const fs = await import('fs/promises');
      try {
        await fs.mkdir(FigmaRecorder.persistentDataDir, { recursive: true });
      } catch (error) {
        // Directory might already exist
      }

      // Launch Firefox with persistent profile for faster subsequent launches
      FigmaRecorder.sharedBrowser = await firefox.launch({
        headless: false, // Keep visible for debugging and monitoring
        args: [
          '--disable-web-security', // Allow cross-origin requests for Figma
          '--disable-features=VizDisplayCompositor', // Improve canvas rendering
          '--disable-gpu-sandbox', // Improve GPU performance
          '--disable-software-rasterizer', // Use hardware acceleration
          '--no-sandbox', // Disable sandboxing for better performance
          '--disable-dev-shm-usage', // Overcome limited resource problems
          '--disable-extensions-except-webgl', // Keep WebGL for Figma
          `--user-data-dir=${FigmaRecorder.persistentDataDir}`, // Persistent profile
        ],
        // Ensure consistent context
        timeout: 60000,
        slowMo: 50 // Reduced delay for faster recording
      });

      logger.info('New shared Firefox browser created with persistent profile');
    } else {
      logger.info('Reusing existing shared Firefox browser');
    }
    
    this.browser = FigmaRecorder.sharedBrowser;
    FigmaRecorder.browserRefCount++;

    // Create new context for each recording session
    const context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true,
      // Optimize for recording
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      // Enable hardware acceleration
      hasTouch: false,
      isMobile: false,
      // Preload common resources
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'max-age=3600'
      }
    });

    this.page = await context.newPage();
    
    // Optimize page for recording
    await this.page.setExtraHTTPHeaders({
      'Keep-Alive': 'timeout=60'
    });

    // Disable unnecessary browser features for better performance
    await this.page.route('**/*', (route) => {
      const request = route.request();
      const resourceType = request.resourceType();
      
      // Block unnecessary resources to speed up loading
      if (resourceType === 'image' && !request.url().includes('figma')) {
        route.abort();
      } else if (resourceType === 'font' && !request.url().includes('figma')) {
        route.abort();
      } else if (resourceType === 'media' && !request.url().includes('figma')) {
        route.abort();
      } else {
        route.continue();
      }
    });

    logger.info('Firefox browser initialized successfully');
  }

  async navigateToFigma(figmaUrl: string, waitForCanvas: boolean = true): Promise<CanvasInfo> {
    if (!this.page) {
      throw new Error('Browser not initialized. Call initialize() first.');
    }

    logger.info(`Navigating to Figma: ${figmaUrl}`);
    
    try {
      // Navigate to Figma with generous timeout
      await this.page.goto(figmaUrl, { 
        waitUntil: 'networkidle',
        timeout: 60000 
      });

      // Wait for page to load completely
      await this.page.waitForLoadState('domcontentloaded');
      
      // Give Figma extra time to initialize and render the prototype
      await this.page.waitForTimeout(5000);

      // Try to click away any dialogs or overlays that might be blocking the canvas
      try {
        // Click on the canvas area to make sure it's focused
        await this.page.click('canvas', { timeout: 5000 });
      } catch {
        // Ignore if no canvas or click fails
      }

      // Wait a bit more for any transitions to complete
      await this.page.waitForTimeout(2000);

      if (waitForCanvas) {
        return await this.detectCanvas();
      }

      return { detected: false };
    } catch (error) {
      logger.error('Failed to navigate to Figma:', error);
      throw new Error(`Navigation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async detectCanvas(): Promise<CanvasInfo> {
    if (!this.page) {
      throw new Error('Page not available');
    }

    logger.info('Detecting Figma canvas...');

    try {
      // Wait for canvas element to appear
      await this.page.waitForSelector('canvas', { timeout: 30000 });
      
      // Wait for Figma to finish loading - look for specific Figma UI elements
      try {
        await this.page.waitForSelector('[data-testid="canvas"]', { timeout: 10000 });
      } catch {
        // Fallback - just wait for any canvas
      }
      
      // Get canvas information after Figma has loaded
      const canvasInfo = await this.page.evaluate(() => {
        // Find the main Figma canvas (usually the largest one)
        const canvases = Array.from(document.querySelectorAll('canvas'));
        let largestCanvas = null;
        let maxArea = 0;
        
        for (const canvas of canvases) {
          const rect = canvas.getBoundingClientRect();
          const area = rect.width * rect.height;
          if (area > maxArea) {
            maxArea = area;
            largestCanvas = canvas;
          }
        }
        
        if (!largestCanvas) {
          return { detected: false };
        }

        const rect = largestCanvas.getBoundingClientRect();
        
        // Also get the actual canvas dimensions (not just the displayed size)
        const canvasWidth = largestCanvas.width || rect.width;
        const canvasHeight = largestCanvas.height || rect.height;
        return {
          detected: true,
          bounds: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
          }
        };
      });

      if (canvasInfo.detected) {
        logger.info('Canvas detected successfully:', canvasInfo.bounds);
      } else {
        logger.warn('No canvas found on the page');
      }

      return canvasInfo;
    } catch (error) {
      logger.warn('Canvas detection failed:', error);
      return { detected: false };
    }
  }

  async startRecording(options: RecordingOptions): Promise<RecordingResult> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    const outputDir = join(process.cwd(), 'recordings', `recording-${Date.now()}`);
    await mkdir(outputDir, { recursive: true });

    logger.info(`Starting ${options.recordingMode} recording...`);
    logger.info(`Output directory: ${outputDir}`);

    try {
      // Set custom viewport BEFORE navigating to Figma so the canvas renders correctly
      if (options.customWidth && options.customHeight) {
        await this.page.setViewportSize({
          width: options.customWidth,
          height: options.customHeight
        });
        logger.info(`Viewport set to ${options.customWidth}x${options.customHeight}`);
        
        // Give the page time to adjust to new viewport
        await this.page.waitForTimeout(1000);
      }

      // Navigate to Figma and detect canvas
      const canvasInfo = await this.navigateToFigma(options.figmaUrl, options.waitForCanvas);
      
      if (options.waitForCanvas && !canvasInfo.detected) {
        throw new Error('Canvas not found on Figma page');
      }

      const startTime = Date.now();
      let outputPath: string;
      let frameCount = 0;

      if (options.recordingMode === 'frames') {
        // Frame-by-frame capture
        this.frameCapture = new FrameCapture(
          this.page,
          outputDir,
          options.frameRate || 10
        );
        
        // Wait for frame capture to complete before proceeding
        frameCount = await this.frameCapture.startCapture(canvasInfo, options.duration);
        
        // Ensure frame capture has completely stopped before continuing
        while (this.frameCapture.isActive()) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Convert frames to video if format is mp4 or webm
        if (options.format === 'mp4' || options.format === 'webm') {
          const framesDir = join(outputDir, 'frames');
          const videoFileName = `recording.${options.format}`;
          const videoPath = join(outputDir, videoFileName);
          
          logger.info(`Converting ${frameCount} frames to ${options.format.toUpperCase()}...`);
          
          try {
            await convertFramesToVideo({
              inputDir: framesDir,
              outputPath: videoPath,
              frameRate: options.frameRate || 10,
              format: options.format,
              quality: 'high'
            });
            
            outputPath = videoPath;
            logger.success(`✅ Video created: ${videoFileName}`);
            
          } catch (error) {
            logger.warn('Video conversion failed, keeping frames only');
            outputPath = framesDir;
          }
        } else {
          // PNG format - just keep the frames
          outputPath = join(outputDir, 'frames');
        }
        
      } else {
        // Video recording using MediaRecorder
        this.videoCapture = new VideoCapture(this.page);
        
        await this.videoCapture.startRecording();
        
        // Wait for specified duration or until manually stopped
        if (options.duration && options.duration > 0) {
          const durationMs = options.duration * 1000;
          await new Promise(resolve => setTimeout(resolve, durationMs));
        }
        
        const recordingData = await this.videoCapture.stopRecording();
        const videoFileName = `recording.${options.format}`;
        outputPath = join(outputDir, videoFileName);
        
        // Save video data to file
        const fs = await import('fs/promises');
        await fs.writeFile(outputPath, recordingData);
      }

      const duration = (Date.now() - startTime) / 1000;
      
      // Get final viewport size for result
      const viewport = this.page.viewportSize();
      const actualResolution = viewport ? { width: viewport.width, height: viewport.height } : undefined;

      logger.info(`Recording completed successfully in ${duration.toFixed(2)}s`);

      return {
        success: true,
        outputPath,
        duration,
        frameCount,
        actualResolution
      };

    } catch (error) {
      logger.error('Recording failed:', error);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  async stopRecording(): Promise<void> {
    logger.info('Stopping recording...');
    
    // Stop frame capture first and wait for it to completely finish
    if (this.frameCapture) {
      if (this.frameCapture.isActive()) {
        this.frameCapture.stopCapture();
        
        // Wait for frame capture to completely stop
        let attempts = 0;
        while (this.frameCapture.isActive() && attempts < 50) { // Max 5 seconds
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
        }
        
        if (this.frameCapture.isActive()) {
          logger.warn('Frame capture did not stop gracefully within timeout');
        }
      }
      this.frameCapture = null;
    }
    
    if (this.videoCapture && this.videoCapture.isActive()) {
      await this.videoCapture.stopRecording();
      this.videoCapture = null;
    }
  }

  async cleanup(): Promise<void> {
    logger.info('Cleaning up browser resources...');
    
    try {
      // Ensure recording is stopped first and wait adequately
      await this.stopRecording();
      
      // Wait longer for any pending screenshot operations to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      if (this.page && !this.page.isClosed()) {
        await this.page.close();
        this.page = null;
      }
      
      // Only close shared browser when no more instances are using it
      FigmaRecorder.browserRefCount--;
      if (FigmaRecorder.browserRefCount <= 0 && FigmaRecorder.sharedBrowser) {
        await FigmaRecorder.sharedBrowser.close();
        FigmaRecorder.sharedBrowser = null;
        FigmaRecorder.browserRefCount = 0;
      }
      this.browser = null;
      
      logger.info('Cleanup completed');
    } catch (error) {
      logger.error('Error during cleanup:', error);
    }
  }

  // Static method to force close shared browser
  static async closeSharedBrowser(): Promise<void> {
    if (FigmaRecorder.sharedBrowser) {
      await FigmaRecorder.sharedBrowser.close();
      FigmaRecorder.sharedBrowser = null;
      FigmaRecorder.browserRefCount = 0;
    }
  }

  // Utility method to check if browser is ready
  isInitialized(): boolean {
    return this.browser !== null && this.page !== null;
  }

  // Get current page for advanced operations
  getPage(): Page | null {
    return this.page;
  }
}
