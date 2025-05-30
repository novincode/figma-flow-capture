import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { existsSync, readdirSync, copyFileSync } from 'fs';
import { logger } from './logger';
import { checkFFmpegAvailability } from './ffmpeg-checker';

const execAsync = promisify(exec);

/**
 * Configuration options for FFmpeg video conversion from frame sequences.
 */
export interface FFmpegOptions {
  /** Directory containing frame images */
  inputDir: string;
  /** Output video file path */
  outputPath: string;
  /** Video frame rate (FPS) */
  frameRate: number;
  /** Output video format (mp4, webm, etc.) */
  format: string;
  /** Video quality preset */
  quality?: 'high' | 'medium' | 'low';
  /** Target video width in pixels */
  targetWidth?: number;
  /** Target video height in pixels */
  targetHeight?: number;
}

/**
 * Analyzes frame sequence to detect missing frames and provide statistics.
 * 
 * @param inputDir - Directory containing frame images
 * @returns Object with total frame count and array of missing frame numbers
 * @private
 */
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

/**
 * Fills missing frames in a sequence by duplicating the nearest previous frame.
 * Ensures smooth video playback without gaps or jumps.
 * 
 * @param inputDir - Directory containing frame images
 * @param missingFrames - Array of frame numbers that need to be filled
 * @private
 */
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

/**
 * Converts a sequence of frame images to a video file using FFmpeg.
 * Provides high-quality video encoding with customizable parameters.
 * 
 * Features:
 * - Automatic missing frame detection and filling
 * - Multiple quality presets (high, medium, low)
 * - Custom resolution support with proper scaling
 * - Format-specific optimization (MP4, WebM)
 * - Progress logging and error handling
 * 
 * @param options - FFmpeg conversion configuration
 * @returns Promise that resolves to true if conversion succeeded
 * @throws {Error} If FFmpeg is not available or conversion fails
 * 
 * @example
 * ```typescript
 * await convertFramesToVideo({
 *   inputDir: './frames',
 *   outputPath: './output.mp4',
 *   frameRate: 30,
 *   format: 'mp4',
 *   quality: 'high',
 *   targetWidth: 1920,
 *   targetHeight: 1080
 * });
 * ```
 */
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
      // Use H.264 with QuickTime-compatible settings
      ffmpegCmd += ` -c:v libx264 -pix_fmt yuv420p`;
      
      // Add QuickTime compatibility flags
      ffmpegCmd += ` -movflags +faststart -profile:v baseline -level 3.0`;
      
      // Add options to handle missing frames and ensure proper duration
      // Use modern fps_mode if supported, fallback to vsync for older versions
      ffmpegCmd += ` -fps_mode cfr -fflags +genpts`;
      
      // Quality settings for MP4 with QuickTime optimization
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
    } else if (format === 'gif') {
      // Simplified GIF encoding with good quality
      let gifFilter = `fps=${Math.min(frameRate, 15)}`;
      
      if (targetWidth && targetHeight) {
        gifFilter += `,scale=${targetWidth}:${targetHeight}:flags=lanczos`;
      }
      
      // Quality settings for GIF
      switch (quality) {
        case 'high':
          gifFilter += `,split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5`;
          break;
        case 'medium':
          gifFilter += `,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3`;
          break;
        case 'low':
          gifFilter += `,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer:bayer_scale=1`;
          break;
      }
      
      ffmpegCmd += ` -vf "${gifFilter}"`;
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

/**
 * Converts a WebM video file to GIF format using FFmpeg.
 * Optimized for high-quality GIF output with proper palette generation.
 * 
 * @param inputPath - Path to the input WebM file
 * @param outputPath - Path for the output GIF file
 * @param quality - Quality preset ('high', 'medium', 'low')
 * @returns Promise that resolves to true if conversion succeeded
 * @throws {Error} If FFmpeg is not available or conversion fails
 */
export async function convertWebMToGif(inputPath: string, outputPath: string, quality: 'high' | 'medium' | 'low' = 'high'): Promise<boolean> {
  // Check if FFmpeg is available
  const ffmpegAvailable = await checkFFmpegAvailability();
  if (!ffmpegAvailable) {
    throw new Error('FFmpeg is not available. Please install FFmpeg to convert WebM to GIF.');
  }

  // Check if input file exists
  if (!existsSync(inputPath)) {
    throw new Error(`Input WebM file not found: ${inputPath}`);
  }

  logger.info(`Converting WebM to GIF: ${inputPath} -> ${outputPath}`);

  try {
    // Use a two-pass approach for better GIF quality
    // First generate the palette, then create the GIF
    const tempPalettePath = outputPath.replace('.gif', '_palette.png');
    
    // Step 1: Generate palette
    let paletteCmd = `ffmpeg -y -i "${inputPath}" -vf "fps=15`;
    
    // Add quality settings for palette generation
    switch (quality) {
      case 'high':
        paletteCmd += `,palettegen=max_colors=256:stats_mode=diff"`;
        break;
      case 'medium':
        paletteCmd += `,palettegen=max_colors=128:stats_mode=diff"`;
        break;
      case 'low':
        paletteCmd += `,palettegen=max_colors=64:stats_mode=diff"`;
        break;
    }
    
    paletteCmd += ` "${tempPalettePath}"`;
    
    logger.info(`Generating palette: ${paletteCmd}`);
    await execAsync(paletteCmd);
    
    // Step 2: Create GIF using the palette
    let gifCmd = `ffmpeg -y -i "${inputPath}" -i "${tempPalettePath}" -lavfi "fps=15`;
    
    // Add quality settings for final GIF
    switch (quality) {
      case 'high':
        gifCmd += ` [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle"`;
        break;
      case 'medium':
        gifCmd += ` [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle"`;
        break;
      case 'low':
        gifCmd += ` [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=1:diff_mode=rectangle"`;
        break;
    }
    
    gifCmd += ` "${outputPath}"`;

    logger.info(`Creating GIF: ${gifCmd}`);

    // Execute GIF creation command
    const { stdout, stderr } = await execAsync(gifCmd);
    
    if (stderr && !stderr.includes('frame=')) {
      logger.warn('FFmpeg warnings:', stderr);
    }

    // Clean up temporary palette file
    try {
      if (existsSync(tempPalettePath)) {
        const fs = await import('fs/promises');
        await fs.unlink(tempPalettePath);
      }
    } catch (error) {
      logger.warn('Could not clean up temporary palette file:', error);
    }

    // Check if output file was created
    if (existsSync(outputPath)) {
      logger.success(`✅ WebM to GIF conversion completed: ${outputPath}`);
      return true;
    } else {
      throw new Error('Output GIF file was not created');
    }

  } catch (error) {
    logger.error('FFmpeg WebM to GIF conversion failed:', error);
    if (error instanceof Error && error.message) {
      logger.error('Error details:', error.message);
    }
    throw error;
  }
}

/**
 * Converts a WebM video file to MP4 format using FFmpeg.
 * Uses H.264 encoding with QuickTime-compatible settings.
 * 
 * @param inputPath - Path to the input WebM file
 * @param outputPath - Path for the output MP4 file
 * @returns Promise that resolves to true if conversion succeeded
 * @throws {Error} If FFmpeg is not available or conversion fails
 */
export async function convertWebMToMp4(inputPath: string, outputPath: string): Promise<boolean> {
  // Check if FFmpeg is available
  const ffmpegAvailable = await checkFFmpegAvailability();
  if (!ffmpegAvailable) {
    throw new Error('FFmpeg is not available. Please install FFmpeg to convert WebM to MP4.');
  }

  // Check if input file exists
  if (!existsSync(inputPath)) {
    throw new Error(`Input WebM file not found: ${inputPath}`);
  }

  logger.info(`Converting WebM to MP4: ${inputPath} -> ${outputPath}`);

  try {
    // Build FFmpeg command for WebM to MP4 conversion with QuickTime compatibility
    let ffmpegCmd = `ffmpeg -y -i "${inputPath}"`;
    
    // Use H.264 with QuickTime-compatible settings
    ffmpegCmd += ` -c:v libx264 -pix_fmt yuv420p`;
    ffmpegCmd += ` -movflags +faststart -profile:v baseline -level 3.0`;
    ffmpegCmd += ` -crf 18 -preset medium`;
    
    ffmpegCmd += ` "${outputPath}"`;

    logger.info(`Running FFmpeg command: ${ffmpegCmd}`);

    // Execute FFmpeg command
    const { stdout, stderr } = await execAsync(ffmpegCmd);
    
    if (stderr && !stderr.includes('frame=')) {
      logger.warn('FFmpeg warnings:', stderr);
    }

    // Check if output file was created
    if (existsSync(outputPath)) {
      logger.success(`✅ WebM to MP4 conversion completed: ${outputPath}`);
      return true;
    } else {
      throw new Error('Output MP4 file was not created');
    }

  } catch (error) {
    logger.error('FFmpeg WebM to MP4 conversion failed:', error);
    if (error instanceof Error && error.message) {
      logger.error('Error details:', error.message);
    }
    throw error;
  }
}
