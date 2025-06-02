#!/usr/bin/env node
import { FigmaRecorder } from './core/recorder';
import { RecordingOptions } from './types/recording';
import { checkFFmpegAvailability } from './utils/ffmpeg-checker';
import { logger } from './utils/logger';
import chalk from 'chalk';

// Parse command line arguments
function parseArgs(): RecordingOptions | null {
  const args = process.argv.slice(2);
  
  // Handle help command
  if (args.includes('--help') || args.includes('-h')) {
    console.log('\nUsage:');
    console.log('  tsx src/cli.ts --url <figma-url> [options]');
    console.log('\nRequired:');
    console.log('  --url <url>           Figma prototype URL');
    console.log('\nOptional:');
    console.log('  --mode <mode>         Recording mode (video|frames) [default: video]');
    console.log('  --duration <seconds>  Recording duration');
    console.log('  --width <pixels>      Custom viewport width');
    console.log('  --height <pixels>     Custom viewport height');
    console.log('  --format <format>     Output format (mp4|webm|gif|png) [default: mp4]');
    console.log('  --frame-rate <fps>    Frame rate [default: 30]');
    console.log('  --wait-for-canvas     Wait for canvas to load (true|false) [default: true]');
    console.log('  --stop-mode <mode>    Stop mode (timer|manual) [default: timer]');
    console.log('  --scale-to-fit        Scale canvas to fit dimensions (true|false) [default: false]');
    console.log('  --figma-scaling <mode> Figma scaling mode (scale-down-width|scale-down|min-zoom|contain) [default: scale-down-width]');
    console.log('  --figma-content-scaling <mode> Figma content scaling (fixed|responsive) [default: fixed]');
    process.exit(0);
  }
  
  const options: Partial<RecordingOptions> = {};
  
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    
    switch (flag) {
      case '--url':
        options.figmaUrl = value;
        break;
      case '--mode':
        options.recordingMode = value as 'video' | 'frames';
        break;
      case '--duration':
        options.duration = parseInt(value);
        break;
      case '--width':
        options.customWidth = parseInt(value);
        break;
      case '--height':
        options.customHeight = parseInt(value);
        break;
      case '--format':
        options.format = value as 'mp4' | 'webm' | 'gif' | 'png';
        break;
      case '--frame-rate':
        options.frameRate = parseInt(value);
        break;
      case '--wait-for-canvas':
        options.waitForCanvas = value === 'true';
        break;
      case '--stop-mode':
        options.stopMode = value as 'timer' | 'manual';
        break;
      case '--scale-to-fit':
        options.scaleToFit = value === 'true';
        break;
      case '--figma-scaling':
        options.figmaScaling = value as 'scale-down-width' | 'scale-down' | 'min-zoom' | 'contain';
        break;
      case '--figma-content-scaling':
        options.figmaContentScaling = value as 'fixed' | 'responsive';
        break;
      default:
        console.error(`Unknown argument: ${flag}`);
        return null;
    }
  }
  
  // Validate required arguments
  if (!options.figmaUrl) {
    console.error('Error: --url is required');
    return null;
  }
  
  // Set defaults and return proper RecordingOptions
  return {
    figmaUrl: options.figmaUrl,
    recordingMode: options.recordingMode || 'video',
    format: options.format || 'mp4',
    duration: options.duration,
    frameRate: options.frameRate,
    customWidth: options.customWidth,
    customHeight: options.customHeight,
    waitForCanvas: options.waitForCanvas !== false, // Default to true
    stopMode: options.stopMode || 'timer',
    scaleToFit: options.scaleToFit || false,
    figmaScaling: options.figmaScaling || 'scale-down-width',
    figmaContentScaling: options.figmaContentScaling || 'fixed'
  };
}

function normalizeUrl(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`;
  }
  return url;
}

async function main() {
  console.log(chalk.blue.bold('🎬 Figma Flow Capture Tool (CLI Mode)'));
  
  const options = parseArgs();
  if (!options) {
    console.log('\nUsage:');
    console.log('  tsx src/cli.ts --url <figma-url> [options]');
    console.log('\nRequired:');
    console.log('  --url <url>           Figma prototype URL');
    console.log('\nOptional:');
    console.log('  --mode <mode>         Recording mode (video|frames) [default: video]');
    console.log('  --duration <seconds>  Recording duration');
    console.log('  --width <pixels>      Custom viewport width');
    console.log('  --height <pixels>     Custom viewport height');
    console.log('  --format <format>     Output format (mp4|webm|gif|png) [default: mp4]');
    console.log('  --frame-rate <fps>    Frame rate [default: 30]');
    console.log('  --wait-for-canvas     Wait for canvas to load (true|false) [default: true]');
    console.log('  --stop-mode <mode>    Stop mode (timer|manual) [default: timer]');
    console.log('  --scale-to-fit        Scale canvas to fit dimensions (true|false) [default: false]');
    process.exit(1);
  }
  
  // Check FFmpeg availability
  const ffmpegAvailable = await checkFFmpegAvailability();
  if (!ffmpegAvailable && options.recordingMode === 'frames') {
    logger.warn('FFmpeg not found. Switching to video recording mode.');
    options.recordingMode = 'video';
  }
  
  // Normalize URL
  options.figmaUrl = normalizeUrl(options.figmaUrl);
  
  console.log(chalk.green('Starting recording with options:'));
  console.log(`  URL: ${options.figmaUrl}`);
  console.log(`  Mode: ${options.recordingMode}`);
  console.log(`  Format: ${options.format}`);
  if (options.customWidth && options.customHeight) {
    console.log(`  Resolution: ${options.customWidth}x${options.customHeight}`);
  }
  if (options.duration) {
    console.log(`  Duration: ${options.duration}s`);
  }
  if (options.frameRate) {
    console.log(`  Frame Rate: ${options.frameRate} FPS`);
  }
  console.log();
  
  // Create recorder
  const recorder = new FigmaRecorder();
  
  // Initialize recorder
  await recorder.initialize();
  
  // Handle interruption
  process.on('SIGINT', async () => {
    console.log(chalk.yellow('\n⏹️  Recording interrupted'));
    try {
      await recorder.cleanup();
      console.log(chalk.green('✅ Recording stopped gracefully'));
    } catch (error) {
      console.error(chalk.red('❌ Error stopping recording:'), error);
    }
    process.exit(0);
  });
  
  try {
    // Start recording
    const result = await recorder.startRecording(options);
    
    if (result.success) {
      console.log(chalk.green('✅ Recording completed successfully!'));
      console.log(`📁 Output: ${result.outputPath}`);
      if (result.duration) {
        console.log(`⏱️  Duration: ${result.duration.toFixed(2)}s`);
      }
      if (result.frameCount) {
        console.log(`🎞️  Frames: ${result.frameCount}`);
      }
    } else {
      console.error(chalk.red('❌ Recording failed:'), result.error);
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red('❌ Recording error:'), error);
    process.exit(1);
  } finally {
    // Ensure cleanup always happens
    try {
      await recorder.cleanup();
    } catch (cleanupError) {
      console.error(chalk.red('❌ Cleanup error:'), cleanupError);
    }
  }
}

main().catch(console.error);
