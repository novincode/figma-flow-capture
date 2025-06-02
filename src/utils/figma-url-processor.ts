import { FigmaScalingMode, FigmaContentScaling } from '../types/recording.js';
import { logger } from './logger.js';

/**
 * Utility class for processing and modifying Figma prototype URLs.
 * Handles scaling parameters and URL validation.
 */
export class FigmaUrlProcessor {
  /**
   * Applies scaling parameters to a Figma prototype URL.
   * Modifies or adds the scaling and content-scaling URL parameters.
   * 
   * @param figmaUrl - The original Figma prototype URL
   * @param scaling - Figma scaling mode (default: 'scale-down-width')
   * @param contentScaling - Figma content scaling mode (default: 'fixed')
   * @returns The modified URL with scaling parameters
   * 
   * @example
   * ```typescript
   * const url = 'https://www.figma.com/proto/abc123/MyPrototype';
   * const scaledUrl = FigmaUrlProcessor.applyScaling(url, 'min-zoom', 'fixed');
   * // Result: https://www.figma.com/proto/abc123/MyPrototype?scaling=min-zoom&content-scaling=fixed
   * ```
   */
  static applyScaling(
    figmaUrl: string, 
    scaling: FigmaScalingMode = 'scale-down-width',
    contentScaling: FigmaContentScaling = 'fixed'
  ): string {
    try {
      const url = new URL(figmaUrl);
      
      // Set the scaling parameters
      url.searchParams.set('scaling', scaling);
      url.searchParams.set('content-scaling', contentScaling);
      
      const finalUrl = url.toString();
      logger.info(`Applied Figma scaling: ${scaling}, content-scaling: ${contentScaling}`);
      logger.info(`Final URL: ${finalUrl}`);
      
      return finalUrl;
    } catch (error) {
      logger.warn('Failed to parse Figma URL, using original:', error);
      return figmaUrl;
    }
  }

  /**
   * Validates if a URL is a valid Figma prototype URL.
   * 
   * @param url - The URL to validate
   * @returns True if the URL is a valid Figma prototype URL
   */
  static isValidFigmaUrl(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.hostname === 'www.figma.com' && 
             parsedUrl.pathname.startsWith('/proto/');
    } catch {
      return false;
    }
  }

  /**
   * Extracts current scaling parameters from a Figma URL.
   * 
   * @param figmaUrl - The Figma URL to analyze
   * @returns Object containing current scaling parameters
   */
  static extractScalingParams(figmaUrl: string): {
    scaling?: FigmaScalingMode;
    contentScaling?: FigmaContentScaling;
  } {
    try {
      const url = new URL(figmaUrl);
      const scaling = url.searchParams.get('scaling') as FigmaScalingMode | null;
      const contentScaling = url.searchParams.get('content-scaling') as FigmaContentScaling | null;
      
      return {
        scaling: scaling || undefined,
        contentScaling: contentScaling || undefined
      };
    } catch {
      return {};
    }
  }

  /**
   * Gets a human-readable description of a scaling mode.
   * 
   * @param mode - The scaling mode
   * @returns Human-readable description
   */
  static getScalingDescription(mode: FigmaScalingMode): string {
    switch (mode) {
      case 'scale-down-width':
        return 'Fit Width - Scale down to fit the viewport width';
      case 'scale-down':
        return 'Fit Width & Height - Scale down to fit both dimensions';
      case 'min-zoom':
        return 'Actual Size - Show content at its original size';
      case 'contain':
        return 'Responsive - Adapt content responsively to viewport';
      default:
        return 'Unknown scaling mode';
    }
  }

  /**
   * Gets all available scaling modes with descriptions.
   * 
   * @returns Array of scaling modes with descriptions
   */
  static getAvailableScalingModes(): Array<{
    value: FigmaScalingMode;
    label: string;
    description: string;
  }> {
    return [
      {
        value: 'scale-down-width',
        label: 'Fit Width',
        description: 'Scale down to fit the viewport width'
      },
      {
        value: 'scale-down',
        label: 'Fit Width & Height',
        description: 'Scale down to fit both width and height'
      },
      {
        value: 'min-zoom',
        label: 'Actual Size',
        description: 'Show content at its original size'
      },
      {
        value: 'contain',
        label: 'Responsive',
        description: 'Adapt content responsively to viewport'
      }
    ];
  }
}
