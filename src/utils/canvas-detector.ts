import { Page } from 'playwright';
import { CanvasInfo } from '../types/recording.js';
import { logger } from './logger.js';

export class FigmaCanvasDetector {
  constructor(private page: Page) {}

  async waitForCanvas(timeout: number = 30000): Promise<CanvasInfo> {
    logger.info('Waiting for Figma canvas to load...');
    
    try {
      // Wait for the main canvas element
      await this.page.waitForSelector('canvas', { timeout });
      
      // Wait for the page to be fully loaded and interactive
      await this.page.waitForLoadState('networkidle');
      
      // Additional wait for Figma specific elements
      const canvasInfo = await this.detectCanvasInfo();
      
      if (canvasInfo.detected) {
        logger.success('Figma canvas detected and ready!');
        return canvasInfo;
      } else {
        logger.warn('Canvas detected but may not be fully ready');
        return canvasInfo;
      }
    } catch (error) {
      logger.error('Failed to detect Figma canvas:', error);
      return { detected: false };
    }
  }

  async detectCanvasInfo(): Promise<CanvasInfo> {
    try {
      // Get canvas elements and their properties
      const canvasInfo = await this.page.evaluate(() => {
        const canvases = Array.from(document.querySelectorAll('canvas'));
        
        if (canvases.length === 0) {
          return { detected: false };
        }

        // Find the main Figma canvas (usually the largest visible one)
        let mainCanvas = canvases[0];
        let maxArea = 0;

        for (const canvas of canvases) {
          const rect = canvas.getBoundingClientRect();
          const area = rect.width * rect.height;
          
          // Only consider visible canvases
          if (area > maxArea && rect.width > 100 && rect.height > 100) {
            maxArea = area;
            mainCanvas = canvas;
          }
        }

        const rect = mainCanvas.getBoundingClientRect();
        
        // Get scroll offset to adjust coordinates
        const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
        const scrollY = window.pageYOffset || document.documentElement.scrollTop;
        
        return {
          detected: true,
          bounds: {
            x: Math.max(0, rect.x + scrollX),
            y: Math.max(0, rect.y + scrollY),
            width: rect.width,
            height: rect.height
          },
          frameSize: {
            width: mainCanvas.width || rect.width,
            height: mainCanvas.height || rect.height
          }
        };
      });

      return canvasInfo;
    } catch (error) {
      logger.error('Error detecting canvas info:', error);
      return { detected: false };
    }
  }

  async waitForFlowStart(): Promise<boolean> {
    logger.info('Waiting for Figma flow to start...');
    
    try {
      // Look for the play button and wait for it to be clicked or flow to start
      await this.page.waitForFunction(() => {
        // Check if there's a play button
        const playButton = document.querySelector('[data-testid="play-button"], button[title*="Play"], button[aria-label*="Play"]');
        
        // Check if the flow is already playing (look for common indicators)
        const isPlaying = document.querySelector('[data-testid="pause-button"], button[title*="Pause"], button[aria-label*="Pause"]') ||
                         document.querySelector('.prototype-player--playing') ||
                         document.querySelector('[data-prototype-player-state="playing"]');
        
        return !playButton || isPlaying;
      }, {}, { timeout: 30000 });

      logger.success('Figma flow has started!');
      return true;
    } catch (error) {
      logger.warn('Could not detect flow start, proceeding anyway...');
      return false;
    }
  }

  async clickPlayButton(): Promise<boolean> {
    try {
      // Try to find and click the play button
      const playButtonSelectors = [
        '[data-testid="play-button"]',
        'button[title*="Play"]',
        'button[aria-label*="Play"]',
        '.play-button',
        '.prototype-player__play-button'
      ];

      for (const selector of playButtonSelectors) {
        try {
          const button = await this.page.$(selector);
          if (button) {
            logger.info('Found play button, clicking...');
            await button.click();
            await this.page.waitForTimeout(1000); // Wait a bit for the flow to start
            return true;
          }
        } catch (error) {
          // Continue to next selector
        }
      }

      logger.warn('No play button found, assuming flow is auto-playing');
      return false;
    } catch (error) {
      logger.error('Error clicking play button:', error);
      return false;
    }
  }

  async optimizeForRecording(): Promise<void> {
    try {
      logger.info('Optimizing page for recording...');

      // Hide Figma UI elements that might interfere with recording
      await this.page.addStyleTag({
        content: `
          /* Hide Figma UI overlays */
          [data-testid="toolbar"],
          .toolbar,
          .figma-toolbar,
          .prototype-player__controls,
          .prototype-player__ui {
            display: none !important;
          }
          
          /* Ensure canvas takes full space */
          canvas {
            max-width: 100% !important;
            max-height: 100% !important;
          }
          
          /* Hide cursor if needed */
          body.hide-cursor * {
            cursor: none !important;
          }
        `
      });

      // Try to enter fullscreen or focus mode
      await this.page.evaluate(() => {
        // Try to press 'F' for fullscreen in Figma
        const event = new KeyboardEvent('keydown', { key: 'f', code: 'KeyF' });
        document.dispatchEvent(event);
      });

      await this.page.waitForTimeout(1000);
    } catch (error) {
      logger.warn('Could not optimize page for recording:', error);
    }
  }
}
