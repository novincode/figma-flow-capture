import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { existsSync, readdirSync, copyFileSync } from 'fs';
import { logger } from './logger.js';
import { checkFFmpegAvailability } from './ffmpeg-checker.js';

const execAsync = promisify(exec);

export interface FFmpegOptions {
  inputDir: string;
  outputPath: string;
  frameRate: number;
  format: string;
  quality?: 'high' | 'medium' | 'low';
  targetWidth?: number;
  targetHeight?: number;
}

function checkFrameSequence(inputDir: string): { totalFrames: number; missingFrames: number[] } {
  const files = readdirSync(inputDir).filter((f: string) => f.startsWith('frame_') && f.endsWith('.png'));
  const frameNumbers = files.map((f: string) => parseInt(f.match(/frame_(\d+)\.png/)?.[1] || '0')).sort((a: number, b: number) => a - b);
  
  const missingFrames: number[] = [];
  const maxFrame = Math.max(...frameNumbers);
  
  for (let i = 0; i <= maxFrame; i++) {
    if (!frameNumbers.includes(i)) {
      missingFrames.push(i);
    }
  }
  
  return { totalFrames: frameNumbers.length, missingFrames };
}

async function fillMissingFrames(inputDir: string, missingFrames: number[]): Promise<void> {
  for (const frameNumber of missingFrames) {
    const missingFramePath = join(inputDir, `frame_${String(frameNumber).padStart(6, '0')}.png`);
    
    // Find the previous available frame to duplicate
    let previousFrameNumber = frameNumber - 1;
    while (previousFrameNumber >= 0) {
      const previousFramePath = join(inputDir, `frame_${String(previousFrameNumber).padStart(6, '0')}.png`);
      if (existsSync(previousFramePath)) {
        try {
          copyFileSync(previousFramePath, missingFramePath);
          logger.info(`Filled missing frame ${frameNumber} by duplicating frame ${previousFrameNumber}`);
          break;
        } catch (error) {
          logger.warn(`Failed to fill frame ${frameNumber}:`, error);
        }
      }
      previousFrameNumber--;
    }
    
    // If no previous frame found, try next frame
    if (!existsSync(missingFramePath)) {
      let nextFrameNumber = frameNumber + 1;
      while (nextFrameNumber <= 10000) { // reasonable upper limit
        const nextFramePath = join(inputDir, `frame_${String(nextFrameNumber).padStart(6, '0')}.png`);
        if (existsSync(nextFramePath)) {
          try {
            copyFileSync(nextFramePath, missingFramePath);
            logger.info(`Filled missing frame ${frameNumber} by duplicating frame ${nextFrameNumber}`);
            break;
          } catch (error) {
            logger.warn(`Failed to fill frame ${frameNumber}:`, error);
          }
        }
        nextFrameNumber++;
      }
    }
  }
}

export async function convertFramesToVideo(options: FFmpegOptions): Promise<boolean> {
  const { inputDir, outputPath, frameRate, format, quality = 'high', targetWidth, targetHeight } = options;

  // Check if FFmpeg is available
  const ffmpegAvailable = await checkFFmpegAvailability();
  if (!ffmpegAvailable) {
    throw new Error('FFmpeg is not available. Please install FFmpeg to convert frames to video.');
  }

  // Check if frames directory exists and has frames
  const framesPattern = join(inputDir, 'frame_%06d.png');
  const firstFrame = join(inputDir, 'frame_000000.png');
  
  if (!existsSync(firstFrame)) {
    throw new Error(`No frames found in ${inputDir}`);
  }

  // Check frame sequence and fill missing frames
  const { totalFrames, missingFrames } = checkFrameSequence(inputDir);
  if (missingFrames.length > 0) {
    logger.warn(`Missing frames detected: ${missingFrames.join(', ')}`);
    logger.info(`Total frames found: ${totalFrames}`);
    logger.info('Filling missing frames to ensure continuous sequence...');
    
    // Fill missing frames by duplicating the previous frame
    await fillMissingFrames(inputDir, missingFrames);
  } else {
    logger.info(`All frames are present (${totalFrames} frames detected).`);
  }

  logger.info(`Converting frames to ${format.toUpperCase()} video...`);
  logger.info(`Input pattern: ${framesPattern}`);
  logger.info(`Output: ${outputPath}`);
  logger.info(`Frame rate: ${frameRate}fps`);

  try {
    // Build FFmpeg command based on format and quality
    let ffmpegCmd = `ffmpeg -y -framerate ${frameRate} -i "${framesPattern}"`;
    
    // Add scaling filter if target dimensions are specified
    if (targetWidth && targetHeight) {
      ffmpegCmd += ` -vf "scale=${targetWidth}:${targetHeight}:flags=lanczos"`;
      logger.info(`Adding scaling to ${targetWidth}x${targetHeight}`);
    }
    
    // Add format-specific encoding options
    if (format === 'mp4') {
      ffmpegCmd += ` -c:v libx264 -pix_fmt yuv420p`;
      
      // Add options to handle missing frames and ensure proper duration
      // Use modern fps_mode if supported, fallback to vsync for older versions
      ffmpegCmd += ` -fps_mode cfr -fflags +genpts`;
      
      // Quality settings for MP4
      switch (quality) {
        case 'high':
          ffmpegCmd += ` -crf 18 -preset slower`;
          break;
        case 'medium':
          ffmpegCmd += ` -crf 23 -preset medium`;
          break;
        case 'low':
          ffmpegCmd += ` -crf 28 -preset fast`;
          break;
      }
    } else if (format === 'webm') {
      ffmpegCmd += ` -c:v libvpx-vp9 -pix_fmt yuv420p`;
      
      // Add options to handle missing frames (use modern fps_mode)
      ffmpegCmd += ` -fps_mode cfr -fflags +genpts`;
      
      // Quality settings for WebM
      switch (quality) {
        case 'high':
          ffmpegCmd += ` -crf 10 -b:v 2M`;
          break;
        case 'medium':
          ffmpegCmd += ` -crf 20 -b:v 1M`;
          break;
        case 'low':
          ffmpegCmd += ` -crf 30 -b:v 500k`;
          break;
      }
    }

    // Add output path
    ffmpegCmd += ` "${outputPath}"`;

    logger.info(`Running FFmpeg command: ${ffmpegCmd}`);

    // Execute FFmpeg command
    const { stdout, stderr } = await execAsync(ffmpegCmd);
    
    if (stderr && !stderr.includes('frame=')) {
      logger.warn('FFmpeg warnings:', stderr);
    }

    // Check if output file was created
    if (existsSync(outputPath)) {
      logger.success(`✅ Video conversion completed: ${outputPath}`);
      return true;
    } else {
      throw new Error('Output video file was not created');
    }

  } catch (error) {
    logger.error('FFmpeg conversion failed:', error);
    if (error instanceof Error && error.message) {
      logger.error('Error details:', error.message);
    }
    throw error;
  }
}

export async function getVideoInfo(videoPath: string): Promise<{ duration: number; frameCount: number; resolution: { width: number; height: number } } | null> {
  try {
    const cmd = `ffprobe -v quiet -print_format json -show_format -show_streams "${videoPath}"`;
    const { stdout } = await execAsync(cmd);
    const info = JSON.parse(stdout);
    
    const videoStream = info.streams.find((stream: any) => stream.codec_type === 'video');
    if (!videoStream) return null;

    return {
      duration: parseFloat(info.format.duration),
      frameCount: parseInt(videoStream.nb_frames) || 0,
      resolution: {
        width: videoStream.width,
        height: videoStream.height
      }
    };
  } catch (error) {
    logger.warn('Could not get video info:', error);
    return null;
  }
}
