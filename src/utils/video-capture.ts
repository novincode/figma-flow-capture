import { Page } from 'playwright';
import { logger } from './logger.js';

/**
 * Handles real-time video recording of Figma canvas using browser MediaRecorder API.
 * Provides simplified, direct recording without complex scaling or transformation logic.
 * 
 * Features:
 * - Direct canvas stream capture at 30 FPS
 * - WebM/VP8 encoding with fallback to MP4/H.264
 * - Automatic format detection based on browser support
 * - Built-in error handling and recovery
 * 
 * @example
 * ```typescript
 * const capture = new VideoCapture(page);
 * await capture.startRecording();
 * // ... user interaction ...
 * const blob = await capture.stopRecording();
 * ```
 */
export class VideoCapture {
  /** Flag indicating if recording is currently active */
  private isRecording = false;

  /**
   * Creates a new VideoCapture instance.
   * @param page - Playwright page instance containing the Figma canvas
   */
  constructor(private page: Page) {}

  /**
   * Starts video recording of the Figma canvas.
   * Uses MediaRecorder API to capture canvas stream directly at 30 FPS.
   * Automatically selects best supported video format (WebM preferred, MP4 fallback).
   * 
   * @throws {Error} If recording is already in progress
   * @throws {Error} If no canvas element is found
   * @throws {Error} If canvas has no dimensions
   * @throws {Error} If MediaRecorder setup fails
   */
  async startRecording(): Promise<void> {
    if (this.isRecording) {
      throw new Error('Recording already in progress');
    }

    this.isRecording = true;
    logger.info('Starting simple browser media recording...');

    // Simple MediaRecorder implementation - no complex scaling
    await this.page.evaluate(() => {
      return new Promise<void>((resolve, reject) => {
        const canvas = document.querySelector('canvas') as HTMLCanvasElement;
        if (!canvas) {
          reject(new Error('No canvas found for recording'));
          return;
        }

        try {
          // Ensure canvas is visible and has content
          const rect = canvas.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) {
            reject(new Error('Canvas has no dimensions'));
            return;
          }

          // Get canvas stream directly - no scaling, no complexity
          const stream = canvas.captureStream(30); // 30 FPS
          
          // Verify stream has tracks
          if (stream.getVideoTracks().length === 0) {
            reject(new Error('No video tracks in canvas stream'));
            return;
          }

          // Simple MediaRecorder setup with best compatibility
          let mediaRecorder: MediaRecorder;
          try {
            // Try WebM first (best Firefox support)
            if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
              mediaRecorder = new MediaRecorder(stream, { 
                mimeType: 'video/webm;codecs=vp8',
                videoBitsPerSecond: 2500000 // 2.5 Mbps
              });
            } else if (MediaRecorder.isTypeSupported('video/webm')) {
              mediaRecorder = new MediaRecorder(stream, { 
                mimeType: 'video/webm',
                videoBitsPerSecond: 2500000
              });
            } else {
              // Fallback to browser default
              mediaRecorder = new MediaRecorder(stream, {
                videoBitsPerSecond: 2500000
              });
            }
          } catch (e) {
            reject(new Error('Could not create MediaRecorder: ' + e));
            return;
          }

          const chunks: Blob[] = [];

          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              chunks.push(event.data);
              console.log('Data chunk recorded:', event.data.size, 'bytes');
            }
          };

          mediaRecorder.onstop = () => {
            console.log('Recording stopped, total chunks:', chunks.length);
            if (chunks.length === 0) {
              console.error('No recording data collected');
              (window as any).recordingError = 'No recording data found';
              return;
            }
            
            const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'video/webm' });
            console.log('Created recording blob:', blob.size, 'bytes');
            (window as any).recordingBlob = blob;
          };

          mediaRecorder.onerror = (event) => {
            console.error('MediaRecorder error:', event);
            (window as any).recordingError = 'MediaRecorder failed';
          };

          mediaRecorder.onstart = () => {
            console.log('MediaRecorder started successfully');
          };

          // Store recorder for later access
          (window as any).mediaRecorder = mediaRecorder;
          (window as any).recordingChunks = chunks;
          
          // Start recording with data collection every 500ms
          mediaRecorder.start(500);
          
          resolve();

        } catch (error) {
          reject(error);
        }
      });
    });
  }

  /**
   * Stops the active video recording and returns the recorded data.
   * Handles MediaRecorder state transitions and data collection gracefully.
   * Automatically cleans up browser-side recording objects.
   * 
   * @returns Promise that resolves to the recorded video data as Uint8Array
   * @throws {Error} If no recording is in progress
   * @throws {Error} If no recording data was captured
   * @throws {Error} If MediaRecorder is not found or failed
   */
  async stopRecording(): Promise<Uint8Array> {
    if (!this.isRecording) {
      throw new Error('No recording in progress');
    }

    this.isRecording = false;
    logger.info('Stopping browser media recording...');

    // Stop recording and get data
    const recordingData = await this.page.evaluate(() => {
      return new Promise<Uint8Array>((resolve, reject) => {
        const mediaRecorder = (window as any).mediaRecorder;
        if (!mediaRecorder) {
          reject(new Error('No media recorder found'));
          return;
        }

        // Check if there's already an error
        const recordingError = (window as any).recordingError;
        if (recordingError) {
          reject(new Error(recordingError));
          return;
        }

        if (mediaRecorder.state === 'inactive') {
          // Already stopped, get the blob
          const blob = (window as any).recordingBlob;
          if (blob && blob.size > 0) {
            blob.arrayBuffer().then((arrayBuffer: ArrayBuffer) => {
              resolve(new Uint8Array(arrayBuffer));
            }).catch(reject);
          } else {
            reject(new Error('No recording data found'));
          }
          return;
        }

        mediaRecorder.onstop = async () => {
          try {
            // Wait a moment for blob to be ready
            await new Promise(resolve => setTimeout(resolve, 100));
            
            const blob = (window as any).recordingBlob;
            if (blob && blob.size > 0) {
              console.log('Converting blob to array buffer, size:', blob.size);
              const arrayBuffer = await blob.arrayBuffer();
              resolve(new Uint8Array(arrayBuffer));
            } else {
              // Try to create blob from chunks directly
              const chunks = (window as any).recordingChunks;
              if (chunks && chunks.length > 0) {
                const finalBlob = new Blob(chunks, { type: mediaRecorder.mimeType || 'video/webm' });
                if (finalBlob.size > 0) {
                  const arrayBuffer = await finalBlob.arrayBuffer();
                  resolve(new Uint8Array(arrayBuffer));
                } else {
                  reject(new Error('No recording data found - chunks were empty'));
                }
              } else {
                reject(new Error('No recording data found - no chunks collected'));
              }
            }
          } catch (error) {
            reject(error);
          }
        };

        // Stop the recorder
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.requestData(); // Get any remaining data
          setTimeout(() => {
            mediaRecorder.stop();
          }, 100);
        } else {
          mediaRecorder.stop();
        }
      });
    });

    // Clean up
    await this.page.evaluate(() => {
      delete (window as any).mediaRecorder;
      delete (window as any).recordingBlob;
      delete (window as any).recordingChunks;
      delete (window as any).recordingError;
    });

    return recordingData;
  }

  /**
   * Checks if video recording is currently active.
   * @returns True if recording is in progress, false otherwise
   */
  isActive(): boolean {
    return this.isRecording;
  }
}
