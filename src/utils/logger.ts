import chalk from 'chalk';

/**
 * Colorized console logger with emoji icons for different log levels.
 * Provides consistent, visually appealing output for the recording tool.
 * 
 * @example
 * ```typescript
 * import { logger } from './logger.js';
 * 
 * logger.info('Starting recording...');
 * logger.success('Recording completed!');
 * logger.warn('Low disk space detected');
 * logger.error('Failed to connect to Figma');
 * ```
 */
export class Logger {
  /**
   * Log an informational message with blue color and info icon.
   * @param message - The message to log
   * @param args - Additional arguments to log
   */
  info(message: string, ...args: any[]): void {
    console.log(chalk.blue('ℹ'), message, ...args);
  }

  /**
   * Log a success message with green color and checkmark icon.
   * @param message - The message to log
   * @param args - Additional arguments to log
   */
  success(message: string, ...args: any[]): void {
    console.log(chalk.green('✅'), message, ...args);
  }

  /**
   * Log a warning message with yellow color and warning icon.
   * @param message - The message to log
   * @param args - Additional arguments to log
   */
  warn(message: string, ...args: any[]): void {
    console.log(chalk.yellow('⚠️'), message, ...args);
  }

  /**
   * Log an error message with red color and error icon.
   * @param message - The message to log
   * @param args - Additional arguments to log
   */
  error(message: string, ...args: any[]): void {
    console.log(chalk.red('❌'), message, ...args);
  }
}

/** Singleton logger instance for use throughout the application */
export const logger = new Logger();
