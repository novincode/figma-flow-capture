#!/usr/bin/env node

import prompts from 'prompts';
import chalk from 'chalk';
import { FigmaRecorder } from './core/recorder-new.js';
import { RecordingOptions } from './types/recording.js';
import { getResolutionChoices } from './utils/resolution-presets.js';
import { checkFFmpegAvailability } from './utils/ffmpeg-checker.js';
import { logger } from './utils/logger.js';

async function main() {
  console.log(chalk.cyan.bold('\n🎬 Enhanced Figma Flow Capture Tool\n'));
  
  try {
    // Check FFmpeg availability for frame-based recording
    const ffmpegAvailable = await checkFFmpegAvailability();
    
    // Get Figma URL
    const urlResponse = await prompts({
      type: 'text',
      name: 'url',
      message: 'Enter the Figma prototype URL:',
      validate: (value) => {
        if (!value) return 'URL is required';
        if (!value.includes('figma.com')) return 'Please enter a valid Figma URL';
        return true;
      }
    });

    if (!urlResponse.url) {
      logger.error('URL is required to continue');
      process.exit(1);
    }

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
          title: 'Frame-by-Frame - Higher quality, requires FFmpeg',
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
      message: 'Select output resolution:',
      choices: getResolutionChoices()
    });

    if (!resolutionResponse.quality) {
      process.exit(1);
    }

    // Custom resolution input if needed
    let customWidth, customHeight;
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
    const stopModeResponse = await prompts({
      type: 'select',
      name: 'stopMode',
      message: 'How should recording stop?',
      choices: [
        {
          title: 'Timer - Record for a specific duration',
          value: 'timer'
        },
        {
          title: 'Manual - Stop manually (Ctrl+C or close browser)',
          value: 'manual'
        },
        {
          title: 'Auto-detect - Stop when flow completes (experimental)',
          value: 'auto-detect'
        }
      ]
    });

    if (!stopModeResponse.stopMode) {
      process.exit(1);
    }

    // Duration input for timer mode
    let duration;
    if (stopModeResponse.stopMode === 'timer') {
      const durationResponse = await prompts({
        type: 'number',
        name: 'duration',
        message: 'Recording duration (seconds):',
        initial: 30,
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
          { title: '24 fps - Cinema standard', value: 24 },
          { title: '30 fps - Standard video (recommended)', value: 30 },
          { title: '60 fps - Smooth motion', value: 60 }
        ]
      });

      if (frameRateResponse.frameRate) {
        frameRate = frameRateResponse.frameRate;
      }
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
      name: 'showAdvanced',
      message: 'Configure advanced options?',
      initial: false
    });

    let waitForCanvas = true;
    let autoResize = false;
    let outputDir = './recordings';

    if (advancedResponse.showAdvanced) {
      const advancedOptions = await prompts([
        {
          type: 'confirm',
          name: 'waitForCanvas',
          message: 'Wait for Figma canvas to load before recording?',
          initial: true
        },
        {
          type: 'confirm',
          name: 'autoResize',
          message: 'Auto-resize viewport to match prototype?',
          initial: false
        },
        {
          type: 'text',
          name: 'outputDir',
          message: 'Output directory:',
          initial: './recordings'
        }
      ]);

      waitForCanvas = advancedOptions.waitForCanvas ?? true;
      autoResize = advancedOptions.autoResize ?? false;
      outputDir = advancedOptions.outputDir || './recordings';
    }

    // Build recording options
    const options: RecordingOptions = {
      url: urlResponse.url,
      recordingMode: modeResponse.recordingMode,
      quality: resolutionResponse.quality,
      stopMode: stopModeResponse.stopMode,
      format: formatResponse.format,
      frameRate,
      waitForCanvas,
      autoResize,
      outputDir,
      ...(duration && { duration }),
      ...(customWidth && { customWidth }),
      ...(customHeight && { customHeight })
    };

    // Display recording summary
    console.log(chalk.yellow('\n📋 Recording Configuration:'));
    console.log(chalk.gray(`• URL: ${options.url}`));
    console.log(chalk.gray(`• Mode: ${options.recordingMode}`));
    console.log(chalk.gray(`• Resolution: ${options.quality}${customWidth ? ` (${customWidth}x${customHeight})` : ''}`));
    console.log(chalk.gray(`• Stop Mode: ${options.stopMode}${duration ? ` (${duration/1000}s)` : ''}`));
    console.log(chalk.gray(`• Format: ${options.format}`));
    if (options.recordingMode === 'frames') {
      console.log(chalk.gray(`• Frame Rate: ${frameRate} fps`));
    }
    console.log(chalk.gray(`• Output: ${outputDir}`));

    const confirmResponse = await prompts({
      type: 'confirm',
      name: 'proceed',
      message: 'Start recording with these settings?',
      initial: true
    });

    if (!confirmResponse.proceed) {
      logger.info('Recording cancelled by user');
      process.exit(0);
    }

    // Start recording
    console.log(chalk.green('\n🚀 Starting recording...\n'));
    
    const recorder = new FigmaRecorder();
    const result = await recorder.record(options);

    if (result.success) {
      console.log(chalk.green.bold('\n✅ Recording completed successfully!'));
      console.log(chalk.cyan(`📁 Output: ${result.outputPath}`));
      
      if (result.frameCount) {
        console.log(chalk.gray(`🎞️  Frames captured: ${result.frameCount}`));
      }
      
      if (result.duration) {
        console.log(chalk.gray(`⏱️  Duration: ${Math.round(result.duration / 1000)}s`));
      }
      
      if (result.actualResolution) {
        console.log(chalk.gray(`📐 Resolution: ${result.actualResolution.width}x${result.actualResolution.height}`));
      }
    } else {
      console.log(chalk.red.bold('\n❌ Recording failed!'));
      console.log(chalk.red(`Error: ${result.error}`));
      process.exit(1);
    }

  } catch (error) {
    logger.error('Application error:', error);
    process.exit(1);
  }
}

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\n👋 Goodbye!'));
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(chalk.yellow('\n\n👋 Process terminated'));
  process.exit(0);
});

// Start the application
main().catch((error) => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});