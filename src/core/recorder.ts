import { firefox, Browser, Page, BrowserContext } from 'playwright';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import { FrameCapture } from '../utils/frame-capture.js';
import { VideoCapture } from '../utils/video-capture.js';
import { convertFramesToVideo } from '../utils/ffmpeg-converter.js';
import { RecordingOptions, RecordingResult, CanvasInfo } from '../types/recording.js';
import { FigmaUrlProcessor } from '../utils/figma-url-processor.js';

/**
 * Main recording orchestrator for capturing Figma prototype flows.
 * Manages browser lifecycle, recording modes, and output generation.
 * 
 * Key Features:
 * - Persistent Firefox browser context for better performance
 * - Dual recording modes: real-time video and frame-by-frame capture
 * - Smart canvas detection and viewport optimization
 * - Custom resolution support with proper scaling
 * - Comprehensive error handling and recovery
 * - Resource cleanup and memory management
 * 
 * Recording Modes:
 * - **Video Mode**: Real-time MediaRecorder capture for quick recordings
 * - **Frame Mode**: High-quality frame capture with FFmpeg video generation
 * 
 * @example
 * ```typescript
 * const recorder = new FigmaRecorder();
 * await recorder.initialize();
 * 
 * const result = await recorder.record({
 *   figmaUrl: 'https://figma.com/proto/...',
 *   recordingMode: 'video',
 *   duration: 30,
 *   format: 'mp4',
 *   customWidth: 1920,
 *   customHeight: 1080
 * });
 * 
 * if (result.success) {
 *   console.log(`Recording saved: ${result.outputPath}`);
 * }
 * 
 * await recorder.cleanup();
 * ```
 */
export class FigmaRecorder {
  /** Browser instance (null when using persistent context) */
  private browser: Browser | null = null;
  
  /** Current browser context */
  private context: BrowserContext | null = null;
  
  /** Active page for recording */
  private page: Page | null = null;
  
  /** Frame capture handler for high-quality recording */
  private frameCapture: FrameCapture | null = null;
  
  /** Video capture handler for real-time recording */
  private videoCapture: VideoCapture | null = null;
  
  /** Shared browser instance - NEVER CLOSE THIS */
  private static sharedBrowser: Browser | null = null;
  
  /** Shared persistent context - NEVER CLOSE THIS */
  private static sharedContext: BrowserContext | null = null;
  
  /** Reference counter for shared context management */
  private static browserRefCount = 0;
  
  /** Directory for persistent browser data (cross-platform compatible) */
  private static persistentDataDir: string = join(process.cwd(), '.browser-data-firefox');
  
  /** Promise to ensure single context initialization */
  private static contextInitialization: Promise<{ browser: Browser; context: BrowserContext }> | null = null;

  /**
   * Initializes the Firefox browser with persistent context for optimal performance.
   * Sets up hardware acceleration and recording-optimized browser flags.
   * Uses shared context pattern to avoid repeated browser launches.
   * 
   * @throws {Error} If browser initialization fails
   */
  async initialize(): Promise<void> {
    logger.info('Initializing Firefox browser with persistent context...');
    
    // Check if we need to create a new context
    let needsNewContext = false;
    
    if (!FigmaRecorder.sharedBrowser || !FigmaRecorder.sharedContext) {
      needsNewContext = true;
      logger.info('No existing shared browser/context found');
    } else {
      // Verify browser and context are still alive
      try {
        if (!FigmaRecorder.sharedBrowser.isConnected()) {
          throw new Error('Browser disconnected');
        }
        
        // Test context by trying to get pages
        await FigmaRecorder.sharedContext.pages();
        logger.info('Reusing existing Firefox persistent browser and context');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.info(`Shared browser/context is invalid (${errorMessage}), creating new instance`);
        needsNewContext = true;
        // Clean up the invalid references
        FigmaRecorder.sharedBrowser = null;
        FigmaRecorder.sharedContext = null;
        FigmaRecorder.browserRefCount = 0;
        
        // Wait for any Firefox cleanup to complete before trying to reuse the profile
        logger.info('Waiting for Firefox profile cleanup...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Create new browser and context if needed
    if (needsNewContext) {
      // Ensure no concurrent initialization
      if (!FigmaRecorder.contextInitialization) {
        logger.info('Creating new shared browser and context...');
        FigmaRecorder.contextInitialization = this.createSharedBrowserAndContext();
      }
      
      // Wait for creation to complete
      const result = await FigmaRecorder.contextInitialization;
      FigmaRecorder.sharedBrowser = result.browser;
      FigmaRecorder.sharedContext = result.context;
      FigmaRecorder.contextInitialization = null;
      logger.info('New Firefox persistent browser and context created and ready');
    }
    
    this.browser = FigmaRecorder.sharedBrowser;
    this.context = FigmaRecorder.sharedContext;
    
    if (!this.browser || !this.context) {
      throw new Error('Failed to initialize browser and context');
    }
    
    FigmaRecorder.browserRefCount++;

    // Create new page in the persistent context
    this.page = await this.context.newPage();
    
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

    logger.info(`Firefox browser initialized successfully (active sessions: ${FigmaRecorder.browserRefCount})`);
  }

  /**
   * Creates a new shared browser and context with optimized settings.
   * This method is called only once per application lifecycle.
   * 
   * @private
   * @returns Promise resolving to browser and context objects
   */
  private async createSharedBrowserAndContext(): Promise<{ browser: Browser; context: BrowserContext }> {
    logger.info('Creating new Firefox persistent browser and context...');
    
    // Clean up any Firefox lock files that might prevent profile reuse
    const fs = await import('fs/promises');
    const path = await import('path');
    
    try {
      // Remove Firefox lock files that might be left behind
      const lockFiles = [
        path.join(FigmaRecorder.persistentDataDir, 'lock'),
        path.join(FigmaRecorder.persistentDataDir, '.parentlock'),
        path.join(FigmaRecorder.persistentDataDir, 'parent.lock')
      ];
      
      for (const lockFile of lockFiles) {
        try {
          await fs.unlink(lockFile);
          logger.info(`Removed Firefox lock file: ${lockFile}`);
        } catch (error) {
          // Lock file might not exist, which is fine
        }
      }
    } catch (error) {
      logger.warn('Error cleaning up Firefox lock files:', error);
    }
    
    // Create persistent user data directory
    try {
      await fs.mkdir(FigmaRecorder.persistentDataDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }

    // Use regular launch + persistent context instead of launchPersistentContext
    let browser: Browser;
    let context: BrowserContext;
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries) {
      try {
        // Launch browser with minimal flags that actually work
        browser = await firefox.launch({
          headless: false,
          args: [
            '--no-sandbox',
            '--disable-dev-shm-usage'
          ],
          timeout: 60000
        });

        // Create persistent context manually
        context = await browser.newContext({
          viewport: { width: 1920, height: 1080 },
          ignoreHTTPSErrors: true,
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          hasTouch: false,
          isMobile: false,
          extraHTTPHeaders: {
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'max-age=3600'
          }
        });

        logger.info('New Firefox browser and context created successfully');
        return { browser, context };
        
      } catch (error) {
        retryCount++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.warn(`Failed to create Firefox browser/context (attempt ${retryCount}/${maxRetries}): ${errorMessage}`);
        
        if (retryCount < maxRetries) {
          // Wait a bit before retrying and clean up any remaining files
          logger.info('Waiting 3 seconds before retry...');
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // Try to clean up the persistent directory on retry
          try {
            // Remove the entire directory and recreate it fresh
            await fs.rm(FigmaRecorder.persistentDataDir, { recursive: true, force: true });
            await fs.mkdir(FigmaRecorder.persistentDataDir, { recursive: true });
            logger.info('Cleaned up persistent directory for retry');
          } catch (cleanupError) {
            logger.warn('Failed to clean up directory for retry:', cleanupError);
          }
        } else {
          throw new Error(`Failed to create Firefox browser/context after ${maxRetries} attempts: ${errorMessage}`);
        }
      }
    }
    
    throw new Error('Should not reach here');
  }

  /**
   * Navigates to the specified Figma URL and initializes the page for recording.
   * Handles page loading, Figma initialization, and optional canvas detection.
   * 
   * @param figmaUrl - The Figma prototype URL to navigate to
   * @param waitForCanvas - Whether to wait for and detect the canvas element (default: true)
   * @returns Promise resolving to canvas information if detected
   * @throws {Error} If browser is not initialized or navigation fails
   * 
   * @example
   * ```typescript
   * const canvasInfo = await recorder.navigateToFigma(
   *   'https://figma.com/proto/abc123/MyPrototype',
   *   true
   * );
   * 
   * if (canvasInfo.detected) {
   *   console.log('Canvas bounds:', canvasInfo.bounds);
   * }
   * ```
   */
  async navigateToFigma(figmaUrl: string, waitForCanvas: boolean = true): Promise<CanvasInfo> {
    if (!this.page) {
      throw new Error('Browser not initialized. Call initialize() first.');
    }

    logger.info(`Navigating to Figma: ${figmaUrl}`);
    logger.info('⏳ Loading page... (this may take a moment)');
    
    try {
      // Navigate to Figma with reasonable timeout
      await this.page.goto(figmaUrl, { 
        waitUntil: 'domcontentloaded', // Less strict than networkidle
        timeout: 90000 // Reduced from 60s to 30s
      });

      // Wait for page to load completely
      await this.page.waitForLoadState('domcontentloaded');
      logger.info('✅ Page loaded successfully');

      // Wait additional time for Figma to initialize
      logger.info('⏳ Waiting for Figma to initialize...');
      await this.page.waitForTimeout(3000);

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

  /**
   * Extracts and sanitizes the page title for use in recording directory names.
   * Attempts to find Figma-specific title elements before falling back to document title.
   * 
   * @returns Promise resolving to a sanitized filename-safe title
   * 
   * @example
   * ```typescript
   * const title = await recorder.getPageTitle();
   * console.log(title); // "my-figma-prototype"
   * ```
   */
  async getPageTitle(): Promise<string> {
    if (!this.page) {
      return 'unknown-page';
    }

    try {
      // Try to get Figma-specific title first
      const figmaTitle = await this.page.evaluate(() => {
        // Look for Figma prototype title
        const titleElement = document.querySelector('[data-testid="prototype-title"]') ||
                           document.querySelector('.figma_title') ||
                           document.querySelector('h1') ||
                           document.querySelector('title');
        
        if (titleElement) {
          return titleElement.textContent?.trim() || '';
        }
        
        // Fallback to document title
        return document.title || '';
      });

      if (figmaTitle) {
        // Clean up the title for use as folder name
        return figmaTitle
          .replace(/[^\w\s-]/g, '') // Remove special characters except spaces and hyphens
          .replace(/\s+/g, '-') // Replace spaces with hyphens
          .toLowerCase()
          .substring(0, 50) // Limit length
          .replace(/-+$/, ''); // Remove trailing hyphens
      }
    } catch (error) {
      logger.warn('Could not extract page title:', error);
    }

    return 'figma-recording';
  }

  private static recordingCounter = 1;

  /**
   * Creates a unique recording directory with timestamp and page title.
   * Generates a structured path: recordings/{pageTitle}-{counter}-{timestamp}
   * 
   * @returns Promise resolving to the absolute path of the created directory
   * @throws {Error} If directory creation fails
   * 
   * @example
   * ```typescript
   * const outputDir = await recorder.createRecordingDirectory();
   * console.log(outputDir); // "/path/to/recordings/my-prototype-1-1703875200000"
   * ```
   */
  async createRecordingDirectory(): Promise<string> {
    const pageTitle = await this.getPageTitle();
    const timestamp = Date.now();
    const recordingName = `${pageTitle}-${FigmaRecorder.recordingCounter++}-${timestamp}`;
    
    const recordingDir = join(process.cwd(), 'recordings', recordingName);
    await mkdir(recordingDir, { recursive: true });
    
    logger.info(`📁 Recording directory: ${recordingName}`);
    return recordingDir;
  }

  /**
   * Detects and analyzes the Figma canvas element on the current page.
   * Finds the largest canvas element and returns its positioning information.
   * 
   * @returns Promise resolving to canvas information including bounds and detection status
   * 
   * @example
   * ```typescript
   * const canvasInfo = await recorder.detectCanvas();
   * if (canvasInfo.detected) {
   *   console.log('Canvas found at:', canvasInfo.bounds);
   * }
   * ```
   * 
   * @private
   */
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

  /**
   * Main recording orchestration method that handles the complete recording workflow.
   * Manages navigation, canvas detection, viewport setup, recording execution, and output generation.
   * 
   * Features:
   * - Automatic canvas detection and sizing
   * - Custom resolution support with proper scaling
   * - Dual recording modes (video/frames) with optimized settings
   * - UI hiding for clean recordings
   * - Frame-to-video conversion with FFmpeg
   * - Comprehensive error handling and recovery
   * 
   * @param options - Recording configuration options
   * @returns Promise resolving to recording result with success status and output information
   * 
   * @example
   * ```typescript
   * const result = await recorder.startRecording({
   *   figmaUrl: 'https://figma.com/proto/...',
   *   recordingMode: 'frames',
   *   duration: 30,
   *   format: 'mp4',
   *   customWidth: 1920,
   *   customHeight: 1080,
   *   frameRate: 30
   * });
   * 
   * if (result.success) {
   *   console.log(`Recording saved: ${result.outputPath}`);
   *   console.log(`Captured ${result.frameCount} frames in ${result.duration}s`);
   * }
   * ```
   */
  async startRecording(options: RecordingOptions): Promise<RecordingResult> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    logger.info(`🎬 Starting ${options.recordingMode} recording...`);

    try {
      // Apply Figma scaling parameters to the URL before navigation
      const processedUrl = FigmaUrlProcessor.applyScaling(
        options.figmaUrl,
        options.figmaScaling || 'scale-down-width',
        options.figmaContentScaling || 'fixed'
      );
      
      // Navigate to Figma first to detect canvas size for auto-sizing
      const canvasInfo = await this.navigateToFigma(processedUrl, options.waitForCanvas);
      
      if (options.waitForCanvas && !canvasInfo.detected) {
        throw new Error('Canvas not found on Figma page');
      }

      // Determine final dimensions
      let finalWidth = options.customWidth || 1920;
      let finalHeight = options.customHeight || 1080;

      // Handle auto-sizing: use canvas dimensions if detected
      if (!options.customWidth && !options.customHeight && canvasInfo.detected && canvasInfo.bounds) {
        finalWidth = canvasInfo.bounds.width;
        finalHeight = canvasInfo.bounds.height;
        logger.info(`Auto-sizing: Using canvas dimensions ${finalWidth}x${finalHeight}`);
      } else if (options.customWidth && options.customHeight) {
        logger.info(`Custom size: ${finalWidth}x${finalHeight}`);
      }

      // Set viewport to exact target size for both modes when custom dimensions are specified
      if (options.customWidth && options.customHeight) {
        // When custom size is specified, use exact dimensions for both video and frame modes
        await this.page.setViewportSize({
          width: finalWidth,
          height: finalHeight
        });
        logger.info(`${options.recordingMode} recording: Viewport set to exact custom size ${finalWidth}x${finalHeight}`);
      } else {
        // For auto-sizing, use slightly larger viewport to accommodate UI
        await this.page.setViewportSize({
          width: Math.max(finalWidth, 1400),
          height: Math.max(finalHeight, 900)
        });
        logger.info(`${options.recordingMode} recording: Viewport set to ${Math.max(finalWidth, 1400)}x${Math.max(finalHeight, 900)} (with UI space)`);
      }
      
      // Give the page time to adjust to new viewport
      await this.page.waitForTimeout(1000);

      // Hide Figma UI for both recording modes to ensure clean canvas
      await this.hideFigmaUI();
      
      // For custom dimensions, wait a bit longer for the viewport to settle
      if (options.customWidth && options.customHeight) {
        await this.page.waitForTimeout(1000);
        logger.info('Viewport set to custom size, skipping aggressive canvas optimization to preserve Figma rendering');
      }

      // Re-detect canvas after viewport and UI changes
      const updatedCanvasInfo = await this.detectCanvas();

      // Create recording directory with page title
      const outputDir = await this.createRecordingDirectory();

      const startTime = Date.now();
      let outputPath: string;
      let frameCount = 0;

      if (options.recordingMode === 'frames') {
        // Frame-by-frame capture - use updated canvas info and enable scaling for custom sizes
        this.frameCapture = new FrameCapture(
          this.page,
          outputDir,
          options.frameRate || 10,
          finalWidth,
          finalHeight,
          !!(options.customWidth && options.customHeight) // Enable scaling for custom dimensions
        );
        
        // Wait for frame capture to complete before proceeding - use updated canvas info
        frameCount = await this.frameCapture.startCapture(updatedCanvasInfo, options.duration);
        
        // Ensure frame capture has completely stopped before continuing
        while (this.frameCapture.isActive()) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Convert frames to video if format is mp4 or webm
        const outputFormat = options.format || 'mp4';
        if (outputFormat === 'mp4' || outputFormat === 'webm') {
          const framesDir = join(outputDir, 'frames');
          const videoFileName = `recording.${outputFormat}`;
          const videoPath = join(outputDir, videoFileName);
          
          logger.info(`Converting ${frameCount} frames to ${outputFormat.toUpperCase()}...`);
          
          try {
            await convertFramesToVideo({
              inputDir: framesDir,
              outputPath: videoPath,
              frameRate: options.frameRate || 30,
              format: outputFormat,
              quality: 'high'
              // Removed scaling parameters - frame capture handles this natively
            });
            
            outputPath = videoPath;
            logger.success(`✅ Video created: ${videoFileName}`);
            
          } catch (error) {
            logger.error('Video conversion failed:', error);
            logger.warn('Keeping frames only due to conversion error');
            outputPath = framesDir;
          }
        } else {
          // PNG format - just keep the frames
          outputPath = join(outputDir, 'frames');
        }
          } else {
        // Video recording using simplified MediaRecorder
        this.videoCapture = new VideoCapture(this.page);
        
        await this.videoCapture.startRecording();
        
        let recordingData: Uint8Array;
        
        // Handle different stop modes
        if (options.stopMode === 'manual') {
          // Manual mode: wait indefinitely until stopRecording is called externally
          logger.info('Recording started in manual mode. Use stopRecording() or Ctrl+C to stop...');
          
          // Keep recording until stopped externally
          // This will be interrupted by stopRecording() or cleanup()
          await new Promise<void>((resolve) => {
            // Store the resolve function so stopRecording can call it
            (this as any)._manualStopResolver = resolve;
            
            // Also handle process interruption for CLI
            const handleInterrupt = () => {
              logger.info('Manual recording stopped by interruption');
              resolve();
            };
            
            process.once('SIGINT', handleInterrupt);
            process.once('SIGTERM', handleInterrupt);
          });
          
          // After manual stop, get the recording data if videoCapture still exists
          if (this.videoCapture && this.videoCapture.isActive()) {
            recordingData = await this.videoCapture.stopRecording();
          } else {
            // VideoCapture was already stopped, get the stored data
            recordingData = (this as any)._recordingData || new Uint8Array(0);
          }
        } else {
          // Timer mode: use duration if specified, otherwise treat as manual mode
          if (options.duration) {
            // Timer mode with specified duration
            const minDuration = 2000; // 2 seconds minimum
            const requestedDuration = options.duration * 1000;
            const actualDuration = Math.max(requestedDuration, minDuration);
            
            logger.info(`Recording for ${actualDuration / 1000}s (minimum: ${minDuration / 1000}s)...`);
            await new Promise(resolve => setTimeout(resolve, actualDuration));
            
            recordingData = await this.videoCapture.stopRecording();
          } else {
            // No duration specified - treat as unlimited recording (manual mode)
            logger.info('Recording started with no duration limit. Use stopRecording() or Ctrl+C to stop...');
            
            // Keep recording until stopped externally
            await new Promise<void>((resolve) => {
              // Store the resolve function so stopRecording can call it
              (this as any)._manualStopResolver = resolve;
              
              // Also handle process interruption for CLI
              const handleInterrupt = () => {
                logger.info('Unlimited recording stopped by interruption');
                resolve();
              };
              
              process.once('SIGINT', handleInterrupt);
              process.once('SIGTERM', handleInterrupt);
            });
            
            // After manual stop, get the recording data if videoCapture still exists
            if (this.videoCapture && this.videoCapture.isActive()) {
              recordingData = await this.videoCapture.stopRecording();
            } else {
              // VideoCapture was already stopped, get the stored data
              recordingData = (this as any)._recordingData || new Uint8Array(0);
            }
          }
        }
        
        // Handle format conversion for video recordings
        const outputFormat = options.format || 'mp4';
        const fs = await import('fs/promises');
        
        if (outputFormat === 'gif') {
          // For GIF output, we need to convert the WebM to GIF
          const tempWebmPath = join(outputDir, 'temp_recording.webm');
          const gifPath = join(outputDir, 'recording.gif');
          
          // Save WebM data to temporary file
          await fs.writeFile(tempWebmPath, recordingData);
          
          logger.info('Converting WebM to GIF...');
          
          try {
            const { convertWebMToGif } = await import('../utils/ffmpeg-converter.js');
            await convertWebMToGif(tempWebmPath, gifPath, 'high');
            
            // Clean up temporary WebM file
            await fs.unlink(tempWebmPath);
            
            outputPath = gifPath;
            logger.success('✅ GIF conversion completed');
          } catch (error) {
            logger.error('GIF conversion failed:', error);
            // Fall back to saving as WebM if conversion fails
            outputPath = join(outputDir, 'recording.webm');
            await fs.writeFile(outputPath, recordingData);
            logger.warn('Saved as WebM due to GIF conversion error');
          }
        } else if (outputFormat === 'mp4') {
          // For MP4, we need to convert WebM to MP4 using FFmpeg
          const tempWebmPath = join(outputDir, 'temp_recording.webm');
          const mp4Path = join(outputDir, 'recording.mp4');
          
          // Save WebM data to temporary file
          await fs.writeFile(tempWebmPath, recordingData);
          
          logger.info('Converting WebM to MP4...');
          
          try {
            const { convertWebMToMp4 } = await import('../utils/ffmpeg-converter.js');
            await convertWebMToMp4(tempWebmPath, mp4Path);
            
            // Clean up temporary WebM file
            await fs.unlink(tempWebmPath);
            
            outputPath = mp4Path;
            logger.success('✅ MP4 conversion completed');
          } catch (error) {
            logger.error('MP4 conversion failed:', error);
            // Fall back to saving as WebM if conversion fails
            outputPath = join(outputDir, 'recording.webm');
            await fs.writeFile(outputPath, recordingData);
            logger.warn('Saved as WebM due to MP4 conversion error');
          }
        } else {
          // For WebM or other formats, save directly
          const videoFileName = `recording.${outputFormat}`;
          outputPath = join(outputDir, videoFileName);
          await fs.writeFile(outputPath, recordingData);
        }
      }

      const duration = (Date.now() - startTime) / 1000;
      
      // Get final viewport size for result (check if page is still available)
      const viewport = this.page && !this.page.isClosed() ? this.page.viewportSize() : null;
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

  /**
   * Stops any active recording operations and ensures proper cleanup.
   * Handles both frame capture and video recording modes with timeout protection.
   * 
   * @throws {Error} If stopping recording operations fails
   * 
   * @example
   * ```typescript
   * await recorder.stopRecording();
   * console.log('Recording stopped successfully');
   * ```
   */
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
    
    // For video capture, store the data before setting to null
    if (this.videoCapture && this.videoCapture.isActive()) {
      const recordingData = await this.videoCapture.stopRecording();
      // Store the recording data for manual mode
      (this as any)._recordingData = recordingData;
      this.videoCapture = null;
    }
    
    // Resolve manual stop if waiting
    if ((this as any)._manualStopResolver) {
      (this as any)._manualStopResolver();
      (this as any)._manualStopResolver = null;
    }
  }

  /**
   * Performs comprehensive cleanup of browser resources and recording components.
   * NEVER closes the shared browser/context - only cleans up this instance.
   * 
   * @throws {Error} If cleanup operations fail (errors are logged but not re-thrown)
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up recorder instance...');
    
    try {
      // Ensure recording is stopped first and wait adequately
      await this.stopRecording();
      
      // Wait longer for any pending screenshot operations to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Close only this instance's page - NEVER touch shared resources
      if (this.page && !this.page.isClosed()) {
        await this.page.close();
        this.page = null;
      }
      
      // Clean up instance references - but keep shared resources alive
      this.context = null;
      this.browser = null;
      
      // Decrement reference count safely
      if (FigmaRecorder.browserRefCount > 0) {
        FigmaRecorder.browserRefCount--;
        logger.info(`Cleanup completed, active sessions: ${FigmaRecorder.browserRefCount}`);
        
        // NEVER CLOSE SHARED BROWSER/CONTEXT FROM HERE
        // They stay alive until explicit shutdown or process exit
        if (FigmaRecorder.browserRefCount <= 0) {
          logger.info('No more active sessions, but keeping shared browser/context alive for future recordings');
        }
      }
      
      logger.info('Recorder instance cleanup completed successfully');
    } catch (error) {
      logger.error('Error during recorder cleanup:', error);
    }
  }

  /**
   * Forces closure of the shared browser and context across all recorder instances.
   * Only call this on application shutdown or emergency cleanup.
   * 
   * @static
   */
  static async closeSharedBrowser(): Promise<void> {
    logger.info('Force closing shared browser and context...');
    
    try {
      // Close context first
      if (FigmaRecorder.sharedContext) {
        await FigmaRecorder.sharedContext.close();
        FigmaRecorder.sharedContext = null;
        logger.info('Shared context closed');
      }
    } catch (error) {
      logger.warn('Error closing shared context:', error);
    }
    
    try {
      // Then close browser
      if (FigmaRecorder.sharedBrowser && FigmaRecorder.sharedBrowser.isConnected()) {
        await FigmaRecorder.sharedBrowser.close();
        FigmaRecorder.sharedBrowser = null;
        logger.info('Shared browser closed');
      }
    } catch (error) {
      logger.warn('Error closing shared browser:', error);
    }
    
    FigmaRecorder.browserRefCount = 0;
    logger.info('Shared browser and context cleanup completed');
  }

  /**
   * Closes the current page without affecting the shared browser context.
   * Used when stopping individual recording sessions while keeping the browser alive for other sessions.
   * The browser context remains active and ready for future recordings.
   */
  async closePage(): Promise<void> {
    logger.info('Closing recording page...');
    
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close();
        this.page = null;
        logger.info('Recording page closed successfully');
      }
      
      // Decrement the reference count since this session is ending
      if (FigmaRecorder.browserRefCount > 0) {
        FigmaRecorder.browserRefCount--;
        logger.info(`Page closed (active sessions: ${FigmaRecorder.browserRefCount})`);
        
        // NEVER CLOSE SHARED BROWSER/CONTEXT - they must stay alive
        if (FigmaRecorder.browserRefCount <= 0) {
          logger.info('No more active sessions, but keeping shared browser/context alive for future recordings');
        }
      }
    } catch (error) {
      logger.error('Error closing page:', error);
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

  // Check if recording is currently active
  isRecording(): boolean {
    return !!(this.frameCapture?.isActive() || this.videoCapture?.isActive());
  }

  private async hideFigmaUI(): Promise<void> {
    if (!this.page) {
      logger.warn('No page available for UI hiding');
      return;
    }
    
    try {
      logger.info('Hiding Figma UI elements for clean recording...');
      
      // Hide Figma UI elements but keep the canvas visible
      await this.page.addStyleTag({
        content: `
          /* Hide Figma UI elements */
          [data-testid="toolbar"],
          .toolbar,
          .figma-toolbar,
          .prototype-player__controls,
          .prototype-player__ui,
          .view-header,
          .view-canvas-toolbar,
          .figma-ui,
          .figma-sidebar,
          .figma-panels {
            display: none !important;
          }
          
          /* Ensure canvas fills the viewport */
          canvas {
            width: 100vw !important;
            height: 100vh !important;
            max-width: 100vw !important;
            max-height: 100vh !important;
            object-fit: contain !important;
            background: transparent !important;
          }
          
          /* Hide scrollbars */
          ::-webkit-scrollbar {
            display: none !important;
          }
          
          /* Ensure clean background */
          body, html {
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
            background: transparent !important;
          }
        `
      });
      
      // Wait for changes to take effect
      await this.page.waitForTimeout(500);
      
    } catch (error) {
      logger.warn('Could not hide Figma UI:', error);
    }
  }

  private async optimizeCanvasForScaling(): Promise<void> {
    if (!this.page) {
      logger.warn('No page available for canvas optimization');
      return;
    }
    
    try {
      logger.info('Optimizing canvas for scaled recording...');
      
      // Try to hide Figma UI elements and maximize canvas area
      await this.page.addStyleTag({
        content: `
          /* Hide Figma UI elements */
          [data-testid="toolbar"],
          .toolbar,
          .figma-toolbar,
          .prototype-player__controls,
          .prototype-player__ui,
          .view-header,
          .view-canvas-toolbar {
            display: none !important;
          }
          
          /* Maximize canvas area */
          canvas {
            max-width: 100vw !important;
            max-height: 100vh !important;
            object-fit: contain !important;
          }
          
          /* Hide scrollbars */
          ::-webkit-scrollbar {
            display: none !important;
          }
          
          /* Ensure full viewport usage */
          body, html {
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
          }
        `
      });

      // Try to enter fullscreen mode
      await this.page.evaluate(() => {
        // Try different methods to enter fullscreen in Figma
        try {
          // Press F key for fullscreen
          const event = new KeyboardEvent('keydown', { 
            key: 'f', 
            code: 'KeyF',
            ctrlKey: false,
            metaKey: false,
            altKey: false,
            shiftKey: false
          });
          document.dispatchEvent(event);
        } catch (e) {
          console.log('Could not trigger fullscreen with F key');
        }
        
        try {
          // Try to request fullscreen on the canvas
          const canvas = document.querySelector('canvas');
          if (canvas && canvas.requestFullscreen) {
            canvas.requestFullscreen().catch(() => {
              console.log('Fullscreen request failed');
            });
          }
        } catch (e) {
          console.log('Could not request canvas fullscreen');
        }
      });
      
      // Wait for changes to take effect
      await this.page.waitForTimeout(1500);
      
    } catch (error) {
      logger.warn('Could not optimize canvas for scaling:', error);
    }
  }

  private async optimizeCanvasForCustomSize(targetWidth: number, targetHeight: number): Promise<void> {
    if (!this.page) {
      logger.warn('No page available for canvas optimization');
      return;
    }
    
    try {
      logger.info(`Optimizing canvas to fill custom size ${targetWidth}x${targetHeight}...`);
      
      // Much gentler approach - just ensure canvas can scale properly without breaking Figma
      await this.page.addStyleTag({
        content: `
          /* Hide UI overlays but preserve Figma's canvas structure */
          [data-testid="toolbar"],
          .toolbar,
          .figma-toolbar,
          .prototype-player__controls,
          .prototype-player__ui,
          .view-header,
          .view-canvas-toolbar {
            visibility: hidden !important;
            opacity: 0 !important;
          }
          
          /* Allow canvas to scale within its container */
          canvas {
            max-width: 100% !important;
            max-height: 100% !important;
            object-fit: contain !important;
          }
          
          /* Ensure canvas container can fill viewport */
          [data-testid="canvas"],
          .canvas-container,
          .canvas-wrapper {
            width: 100% !important;
            height: 100% !important;
          }
          
          /* Hide scrollbars but keep functionality */
          ::-webkit-scrollbar {
            width: 0px !important;
            background: transparent !important;
          }
        `
      });

      // Wait for styles to apply but don't break Figma's structure
      await this.page.waitForTimeout(500);
      
    } catch (error) {
      logger.warn('Could not optimize canvas for custom size:', error);
    }
  }
}
