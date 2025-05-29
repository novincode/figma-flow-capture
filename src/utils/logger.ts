import chalk from 'chalk';

export class Logger {
  info(message: string, ...args: any[]): void {
    console.log(chalk.blue('ℹ'), message, ...args);
  }

  success(message: string, ...args: any[]): void {
    console.log(chalk.green('✅'), message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.log(chalk.yellow('⚠️'), message, ...args);
  }

  error(message: string, ...args: any[]): void {
    console.log(chalk.red('❌'), message, ...args);
  }
}

export const logger = new Logger();
