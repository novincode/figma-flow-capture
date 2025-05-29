import prompts from 'prompts';
import chalk from 'chalk';
import { FigmaRecorder } from './core/recorder';
import { RecordingOptions } from './types/recording';
import { RESOLUTION_PRESETS } from './utils/resolution-presets';
import { checkFFmpegAvailability } from './utils/ffmpeg-checker';
import { logger } from './utils/logger';

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
      title: `${preset.name} (${preset.width}x${preset.height})`,
      value: key
    }))
  });

  if (!resolutionResponse.quality) {
    process.exit(1);
  }

  let customWidth: number | undefined;
  let customHeight: number | undefined;

  if (resolutionResponse.quality === 'custom') {
    const customResolution = await prompts([
      {
        type: 'number',
        name: 'width',
        message: 'Enter custom width (px):',
        validate: (value) => value > 0 ? true : 'Width must be greater than 0'
      },
      {
        type: 'number',
        name: 'height',
        message: 'Enter custom height (px):',
        validate: (value) => value > 0 ? true : 'Height must be greater than 0'
      }
    ]);

    if (!customResolution.width || !customResolution.height) {
      process.exit(1);
    }

    customWidth = customResolution.width;
    customHeight = customResolution.height;
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

    duration = durationResponse.duration * 1000; // Convert to milliseconds
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
          { title: 'WebM - Smaller file size', value: 'webm' }
        ]
      : [
          { title: 'WebM - Default browser format', value: 'webm' },
          { title: 'MP4 - Better compatibility', value: 'mp4' }
        ]
  });

  if (!formatResponse.format) {
    process.exit(1);
  }

  // Advanced options
  const advancedResponse = await prompts({
    type: 'confirm',
    name: 'waitForCanvas',
    message: 'Wait for Figma canvas to be ready before recording?',
    initial: true
  });

  const autoResizeResponse = await prompts({
    type: 'confirm',
    name: 'autoResize',
    message: 'Auto-resize browser to fit selected resolution?',
    initial: true
  });

  // Build options
  const selectedPreset = RESOLUTION_PRESETS[resolutionResponse.quality as keyof typeof RESOLUTION_PRESETS];
  
  const options: RecordingOptions = {
    figmaUrl,
    recordingMode: modeResponse.recordingMode,
    stopMode: stopResponse.stopMode,
    duration,
    frameRate,
    waitForCanvas: advancedResponse.waitForCanvas ?? true,
    autoResize: autoResizeResponse.autoResize ?? true,
    format: formatResponse.format,
    ...(customWidth && { customWidth }),
    ...(customHeight && { customHeight })
  };

  // Show configuration summary
  console.log(chalk.blue('\n📋 Recording Configuration:'));
  console.log(chalk.gray(`• URL: ${options.figmaUrl}`));
  console.log(chalk.gray(`• Mode: ${options.recordingMode}`));
  console.log(chalk.gray(`• Resolution: ${customWidth ? `${customWidth}x${customHeight}` : selectedPreset.name}`));
  console.log(chalk.gray(`• Stop mode: ${options.stopMode}`));
  if (options.duration) {
    console.log(chalk.gray(`• Duration: ${options.duration / 1000}s`));
  }
  if (options.recordingMode === 'frames') {
    console.log(chalk.gray(`• Frame rate: ${options.frameRate} fps`));
  }
  console.log(chalk.gray(`• Format: ${options.format}`));
  console.log(chalk.gray(`• Wait for canvas: ${options.waitForCanvas}`));
  console.log(chalk.gray(`• Auto-resize: ${options.autoResize}\n`));

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
  
  try {
    const result = await recorder.record({
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
        logger.info(`Duration: ${(result.duration / 1000).toFixed(1)}s`);
      }
    } else {
      logger.error(`Recording failed: ${result.error}`);
      process.exit(1);
    }
  } catch (error) {
    logger.error('Recording failed:', error);
    process.exit(1);
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\n🛑 Recording interrupted by user'));
  process.exit(0);
});

main().catch((error) => {
  logger.error('Application error:', error);
  process.exit(1);
});