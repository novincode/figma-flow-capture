import prompts from 'prompts';
import chalk from 'chalk';
import { FigmaRecorder } from './core/recorder';
import { RecordingOptions } from './types/recording';
import { RESOLUTION_PRESETS } from './utils/resolution-presets';
import { checkFFmpegAvailability } from './utils/ffmpeg-checker';
import { logger } from './utils/logger';

// Global recorder for cleanup on interruption
let globalRecorder: FigmaRecorder | null = null;

function normalizeUrl(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`;
  }
  return url;
}

async function main() {
  console.log(chalk.blue.bold('🎬 Figma Flow Capture Tool'));
  console.log(chalk.gray('Enhanced for precise frame-by-frame recording\n'));

  // Check FFmpeg availability
  const ffmpegAvailable = await checkFFmpegAvailability();
  if (!ffmpegAvailable) {
    logger.warn('FFmpeg not found. Frame-by-frame recording will be disabled.');
    logger.info('Install FFmpeg to enable frame capture: https://ffmpeg.org/download.html');
  }

  // Get Figma URL
  const urlResponse = await prompts({
    type: 'text',
    name: 'url',
    message: 'Enter Figma prototype URL:',
    validate: (value) => value.length > 0 ? true : 'URL is required'
  });

  if (!urlResponse.url) {
    process.exit(1);
  }

  const figmaUrl = normalizeUrl(urlResponse.url);

  // Recording mode selection
  const modeResponse = await prompts({
    type: 'select',
    name: 'recordingMode',
    message: 'Select recording mode:',
    choices: [
      {
        title: 'Video Recording - Standard browser video capture (recommended)',
        value: 'video'
      },
      {
        title: 'Frame-by-Frame - Canvas capture with timing metadata',
        value: 'frames',
        disabled: !ffmpegAvailable
      }
    ]
  });

  if (!modeResponse.recordingMode) {
    process.exit(1);
  }

  // Resolution selection
  const resolutionResponse = await prompts({
    type: 'select',
    name: 'quality',
    message: 'Select resolution preset:',
    choices: Object.entries(RESOLUTION_PRESETS).map(([key, preset]) => ({
      title: `${preset.name} (${preset.width === 0 ? 'Auto' : `${preset.width}x${preset.height}`})`,
      value: key
    })).concat([
      { title: 'Custom - Enter your own dimensions', value: 'custom' }
    ])
  });

  if (!resolutionResponse.quality) {
    process.exit(1);
  }

  let customWidth: number | undefined;
  let customHeight: number | undefined;

  if (resolutionResponse.quality === 'custom') {
    const customSizeResponse = await prompts({
      type: 'text',
      name: 'dimensions',
      message: 'Enter custom dimensions (WIDTHxHEIGHT, e.g., 1080x1080):',
      validate: (value) => {
        const match = value.match(/^(\d+)x(\d+)$/i);
        if (!match) {
          return 'Please enter dimensions in format WIDTHxHEIGHT (e.g., 1080x1080)';
        }
        const width = parseInt(match[1]);
        const height = parseInt(match[2]);
        if (width < 100 || height < 100) {
          return 'Width and height must be at least 100 pixels';
        }
        if (width > 7680 || height > 4320) {
          return 'Maximum supported resolution is 7680x4320 (8K)';
        }
        return true;
      }
    });

    if (!customSizeResponse.dimensions) {
      process.exit(1);
    }

    const match = customSizeResponse.dimensions.match(/^(\d+)x(\d+)$/i);
    if (match) {
      customWidth = parseInt(match[1]);
      customHeight = parseInt(match[2]);
    }
  }

  // Stop mode selection
  const stopResponse = await prompts({
    type: 'select',
    name: 'stopMode',
    message: 'How should recording stop?',
    choices: [
      { title: 'Timer - Stop after specified duration', value: 'timer' },
      { title: 'Manual - Stop manually with Ctrl+C', value: 'manual' }
    ]
  });

  if (!stopResponse.stopMode) {
    process.exit(1);
  }

  // Duration for timer mode
  let duration: number | undefined;
  if (stopResponse.stopMode === 'timer') {
    const durationResponse = await prompts({
      type: 'number',
      name: 'duration',
      message: 'Recording duration (seconds):',
      validate: (value) => value > 0 ? true : 'Duration must be greater than 0'
    });

    if (!durationResponse.duration) {
      process.exit(1);
    }

    duration = durationResponse.duration; // Keep in seconds
  }

  // Frame rate for frame-based recording
  let frameRate = 30;
  if (modeResponse.recordingMode === 'frames') {
    const frameRateResponse = await prompts({
      type: 'select',
      name: 'frameRate',
      message: 'Select frame rate:',
      choices: [
        { title: '24 fps - Cinematic', value: 24 },
        { title: '30 fps - Standard (recommended)', value: 30 },
        { title: '60 fps - Smooth', value: 60 }
      ]
    });

    if (!frameRateResponse.frameRate) {
      process.exit(1);
    }

    frameRate = frameRateResponse.frameRate;
  }

  // Output format selection
  const formatResponse = await prompts({
    type: 'select',
    name: 'format',
    message: 'Select output format:',
    choices: modeResponse.recordingMode === 'frames' 
      ? [
          { title: 'MP4 - Best compatibility', value: 'mp4' },
          { title: 'WebM - Smaller file size', value: 'webm' },
          { title: 'GIF - Animated image format', value: 'gif' },
          { title: 'PNG - Frame sequence only', value: 'png' }
        ]
      : [
          { title: 'MP4 - Best compatibility', value: 'mp4' },
          { title: 'WebM - Default browser format', value: 'webm' },
          { title: 'GIF - Animated image format (requires FFmpeg)', value: 'gif', disabled: !ffmpegAvailable }
        ]
  });

  if (!formatResponse.format) {
    process.exit(1);
  }

  // Check FFmpeg requirement for GIF in video mode
  if (formatResponse.format === 'gif' && modeResponse.recordingMode === 'video' && !ffmpegAvailable) {
    logger.error('GIF format requires FFmpeg for video recording mode.');
    logger.info('Please install FFmpeg or choose a different format.');
    process.exit(1);
  }

  // Figma scaling options
  const scalingResponse = await prompts({
    type: 'select',
    name: 'figmaScaling',
    message: 'Select Figma canvas display mode:',
    choices: [
      { title: 'Fit Width - Scale to fit viewport width', value: 'scale-down-width' },
      { title: 'Fit Width & Height - Scale to fit entire viewport', value: 'scale-down' },
      { title: 'Actual Size - Display at original size', value: 'min-zoom' },
      { title: 'Responsive - Adaptive scaling', value: 'contain' }
    ],
    initial: 0
  });

  if (!scalingResponse.figmaScaling) {
    process.exit(1);
  }

  const contentScalingResponse = await prompts({
    type: 'select',
    name: 'figmaContentScaling',
    message: 'Select content scaling behavior:',
    choices: [
      { title: 'Fixed - Content maintains fixed dimensions', value: 'fixed' },
      { title: 'Responsive - Content adapts to viewport', value: 'responsive' }
    ],
    initial: 0
  });

  if (!contentScalingResponse.figmaContentScaling) {
    process.exit(1);
  }

  // Advanced options
  const advancedResponse = await prompts({
    type: 'confirm',
    name: 'waitForCanvas',
    message: 'Wait for Figma canvas to be ready before recording?',
    initial: true
  });

  // Build options
  const selectedPreset = RESOLUTION_PRESETS[resolutionResponse.quality as keyof typeof RESOLUTION_PRESETS];
  
  const options: RecordingOptions = {
    figmaUrl,
    recordingMode: modeResponse.recordingMode,
    duration,
    frameRate,
    waitForCanvas: advancedResponse.waitForCanvas ?? true,
    format: formatResponse.format,
    stopMode: stopResponse.stopMode, // Add stopMode to options
    figmaScaling: scalingResponse.figmaScaling,
    figmaContentScaling: contentScalingResponse.figmaContentScaling,
    ...(customWidth && { customWidth }),
    ...(customHeight && { customHeight }),
    scaleToFit: !!(customWidth && customHeight) // Enable scaling when custom dimensions are provided
  };

  // Show configuration summary
  console.log(chalk.blue('\n📋 Recording Configuration:'));
  console.log(chalk.gray(`• URL: ${options.figmaUrl}`));
  console.log(chalk.gray(`• Mode: ${options.recordingMode}`));
  console.log(chalk.gray(`• Resolution: ${customWidth ? `${customWidth}x${customHeight}` : selectedPreset.name}`));
  if (options.scaleToFit) {
    console.log(chalk.gray(`• Scaling: Canvas will be scaled to fit ${customWidth}x${customHeight}`));
  }
  console.log(chalk.gray(`• Figma scaling: ${options.figmaScaling}`));
  console.log(chalk.gray(`• Content scaling: ${options.figmaContentScaling}`));
  console.log(chalk.gray(`• Stop mode: ${stopResponse.stopMode}`));
  if (options.duration) {
    console.log(chalk.gray(`• Duration: ${options.duration}s`));
  }
  if (options.recordingMode === 'frames') {
    console.log(chalk.gray(`• Frame rate: ${options.frameRate} fps`));
  }
  console.log(chalk.gray(`• Format: ${options.format}`));
  console.log(chalk.gray(`• Wait for canvas: ${options.waitForCanvas}\n`));

  // Confirm before starting
  const confirmResponse = await prompts({
    type: 'confirm',
    name: 'confirm',
    message: 'Start recording with these settings?',
    initial: true
  });

  if (!confirmResponse.confirm) {
    console.log(chalk.yellow('Recording cancelled.'));
    process.exit(0);
  }

  // Start recording
  const recorder = new FigmaRecorder();
  globalRecorder = recorder;
  
  try {
    await recorder.initialize();
    
    const result = await recorder.startRecording({
      ...options,
      customWidth: customWidth || selectedPreset.width,
      customHeight: customHeight || selectedPreset.height
    });

    if (result.success) {
      logger.success(`Recording completed successfully!`);
      logger.info(`Output: ${result.outputPath}`);
      if (result.frameCount) {
        logger.info(`Frames captured: ${result.frameCount}`);
      }
      if (result.duration) {
        logger.info(`Duration: ${result.duration.toFixed(1)}s`);
      }
      
      // Wait a bit before cleanup to ensure all file operations are complete
      logger.info('Finalizing files...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } else {
      logger.error(`Recording failed: ${result.error}`);
      process.exit(1);
    }
  } catch (error) {
    logger.error('Recording failed:', error);
    process.exit(1);
  } finally {
    // Ensure cleanup happens after all operations are complete
    await recorder.cleanup();
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', async () => {
  console.log(chalk.yellow('\n\n🛑 Recording interrupted by user'));
  if (globalRecorder) {
    try {
      // Stop recording first if it's active
      if (globalRecorder.isRecording()) {
        logger.info('Stopping active recording...');
        await globalRecorder.stopRecording();
      }
      await globalRecorder.cleanup();
    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
    }
  }
  // Force close shared browser
  try {
    await FigmaRecorder.closeSharedBrowser();
  } catch (error) {
    logger.error('Error closing shared browser:', error);
  }
  logger.info('Recording stopped gracefully');
  process.exit(0);
});

main().catch(async (error) => {
  logger.error('Application error:', error);
  // Force close shared browser on error
  await FigmaRecorder.closeSharedBrowser();
  process.exit(1);
});