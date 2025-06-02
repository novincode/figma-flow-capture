import { Page } from 'playwright';
import { logger } from './logger';

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
   */  async startRecording(): Promise<void> {
    if (this.isRecording) {
      throw new Error('Recording already in progress');
    }

    this.isRecording = true;
    logger.info('Starting simple browser media recording...');

    // Clean up any existing recording artifacts from previous recording
    await this.page.evaluate(() => {
      // Remove any existing nuclear CSS overrides
      const existingStyle = document.getElementById('figma-recording-style');
      if (existingStyle) {
        existingStyle.remove();
        console.log('Cleaned up existing nuclear CSS');
      }
    });

    // Simple MediaRecorder implementation with CSS dimension fixes
    await this.page.evaluate(() => {
      return new Promise<void>((resolve, reject) => {
        try {
          const canvas = document.querySelector('canvas') as HTMLCanvasElement;
          if (!canvas) {
            reject(new Error('No canvas found for recording'));
            return;
          }

          // Check MediaRecorder support first
          if (!window.MediaRecorder) {
            reject(new Error('MediaRecorder not supported in this browser'));
            return;
          }

          // NUCLEAR CSS FIX: Force everything to full screen
          // Remove any existing recording styles
          const existingStyle = document.getElementById('figma-recording-style');
          if (existingStyle) {
            existingStyle.remove();
          }
          
          // Inject the nuclear CSS that actually works
          const style = document.createElement('style');
          style.id = 'figma-recording-style';
          style.textContent = `
            * {
              margin: 0 !important;
              padding: 0 !important;
              width: 100% !important;
              height: 100% !important;
              position: fixed !important;
              top: 0 !important;
              right: 0 !important;
              left: 0 !important;
              bottom: 0 !important;
            }
          `;
          document.head.appendChild(style);
          
          console.log('Nuclear CSS fix applied - forcing everything to 100%');
          
          // Wait a moment for CSS to take effect
          setTimeout(() => {
            const rect = canvas.getBoundingClientRect();
            console.log('Canvas dimensions after nuclear CSS fix:', {
              intrinsic: { width: canvas.width, height: canvas.height },
              displayed: { width: rect.width, height: rect.height },
              viewport: { width: window.innerWidth, height: window.innerHeight }
            });

            // Canvas should now fill the viewport
            if (rect.width === 0 || rect.height === 0) {
              reject(new Error('Canvas still has no dimensions after nuclear CSS fix'));
              return;
            }

            // Check if canvas has actual content by sampling a pixel
            try {
              const ctx = canvas.getContext('2d');
              if (ctx) {
                const imageData = ctx.getImageData(0, 0, 1, 1);
                console.log('Canvas content check - first pixel:', imageData.data);
              }
            } catch (e) {
              console.warn('Could not check canvas content:', e);
            }

            // Get canvas stream directly - the nuclear CSS should handle everything!
            let stream: MediaStream;
            try {
              stream = canvas.captureStream(30); // 30 FPS
            } catch (e) {
              reject(new Error('Canvas stream capture failed: ' + e));
              return;
            }
            
            // Verify stream has tracks
            const videoTracks = stream.getVideoTracks();
            if (videoTracks.length === 0) {
              reject(new Error('No video tracks in canvas stream'));
              return;
            }

            console.log('Canvas stream created:', {
              active: stream.active,
              videoTracks: videoTracks.length,
              tracks: stream.getTracks().map(t => ({ 
                kind: t.kind, 
                enabled: t.enabled, 
                readyState: t.readyState 
              }))
            });

            // Simple MediaRecorder setup with best compatibility
            let mediaRecorder: MediaRecorder;
            let mimeType: string;
            
            // Check supported MIME types in order of preference
            const supportedTypes = [
              'video/webm;codecs=vp8',
              'video/webm;codecs=vp9', 
              'video/webm',
              'video/mp4;codecs=h264',
              'video/mp4'
            ];
            
            mimeType = supportedTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';
            
            if (!mimeType) {
              reject(new Error('No supported video MIME types found'));
              return;
            }
            
            console.log('Using MIME type:', mimeType);
            
            try {
              mediaRecorder = new MediaRecorder(stream, { 
                mimeType,
                videoBitsPerSecond: 2500000 // 2.5 Mbps
              });
            } catch (e) {
              // Fallback without mimeType specification
              try {
                mediaRecorder = new MediaRecorder(stream, {
                  videoBitsPerSecond: 2500000
                });
                console.log('Using default MediaRecorder format');
              } catch (e2) {
                reject(new Error('Could not create MediaRecorder: ' + e2));
                return;
              }
            }

            const chunks: Blob[] = [];

            mediaRecorder.ondataavailable = (event) => {
              console.log('Data available:', event.data.size, 'bytes, type:', event.data.type);
              if (event.data.size > 0) {
                chunks.push(event.data);
                console.log('Data chunk recorded:', event.data.size, 'bytes, total chunks:', chunks.length);
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
              const errorMsg = (event as any).error?.message || 'Unknown MediaRecorder error';
              (window as any).recordingError = 'MediaRecorder failed: ' + errorMsg;
            };

            mediaRecorder.onstart = () => {
              console.log('MediaRecorder started successfully, state:', mediaRecorder.state);
            };

            // Store recorder for later access
            (window as any).mediaRecorder = mediaRecorder;
            (window as any).recordingChunks = chunks;
            
            // Start recording with data collection every 100ms for better data capture
            mediaRecorder.start(100);
            
            // Wait a moment to ensure recording actually starts before resolving
            setTimeout(() => {
              if (mediaRecorder.state === 'recording') {
                console.log('MediaRecorder confirmed recording, state:', mediaRecorder.state);
                resolve();
              } else {
                reject(new Error('MediaRecorder failed to start recording, state: ' + mediaRecorder.state));
              }
            }, 500);
          }, 500); // Wait for CSS to take effect

        } catch (error) {
          console.error('Video recording setup error:', error);
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
        };        // Stop the recorder
        if (mediaRecorder.state === 'recording') {
          console.log('Requesting final data and stopping recorder...');
          
          // Set up timeout to prevent hanging
          const stopTimeout = setTimeout(() => {
            console.warn('Stop timeout reached, forcing recorder cleanup');
            const chunks = (window as any).recordingChunks;
            if (chunks && chunks.length > 0) {
              const finalBlob = new Blob(chunks, { type: mediaRecorder.mimeType || 'video/webm' });
              (window as any).recordingBlob = finalBlob;
            }
            resolve(new Uint8Array(0)); // Return empty data if timeout
          }, 5000); // 5 second timeout
          
          mediaRecorder.onstop = async () => {
            clearTimeout(stopTimeout);
            try {
              // Wait a moment for blob to be ready
              await new Promise(resolve => setTimeout(resolve, 200));
              
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
              clearTimeout(stopTimeout);
              reject(error);
            }
          };
          
          // Request any remaining data first
          try {
            mediaRecorder.requestData();
          } catch (e) {
            console.warn('requestData failed:', e);
          }
          
          // Stop after a brief delay
          setTimeout(() => {
            try {
              if (mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
              }
            } catch (e) {
              console.error('Error stopping recorder:', e);
              clearTimeout(stopTimeout);
              reject(new Error('Failed to stop recorder: ' + e));
            }
          }, 300); // Increased delay to ensure data is collected
          
        } else if (mediaRecorder.state === 'paused') {
          console.log('Resuming and stopping recorder...');
          mediaRecorder.resume();
          setTimeout(() => {
            try {
              mediaRecorder.stop();
            } catch (e) {
              reject(new Error('Failed to stop paused recorder: ' + e));
            }
          }, 200);
        } else {
          console.log('Recorder already stopped, state:', mediaRecorder.state);
          try {
            mediaRecorder.stop();
          } catch (alreadyStoppedError) {
            console.warn('Error stopping already stopped recorder:', alreadyStoppedError);
            // Try to get existing data
            const blob = (window as any).recordingBlob;
            if (blob && blob.size > 0) {
              blob.arrayBuffer().then((arrayBuffer: ArrayBuffer) => {
                resolve(new Uint8Array(arrayBuffer));
              }).catch(reject);
            } else {
              reject(new Error('No recording data available'));
            }
          }
        }
      });
    });

    // Clean up browser-side objects and remove nuclear CSS
    await this.page.evaluate(() => {
      // Remove the nuclear CSS fix
      const recordingStyle = document.getElementById('figma-recording-style');
      if (recordingStyle) {
        recordingStyle.remove();
        console.log('Nuclear CSS fix removed');
      }
      
      // Clean up recording objects
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

  /**
   * Analyzes the Figma canvas and determines if virtual canvas will be needed
   * for proper dimension recording. Useful for debugging dimension issues.
   * 
   * @returns Promise with canvas analysis information
   */
  async analyzeCanvasDimensions(): Promise<{
    canvasFound: boolean;
    originalDimensions: { width: number; height: number };
    displayedDimensions: { width: number; height: number };
    targetDimensions: { width: number; height: number };
    needsVirtualCanvas: boolean;
    reason?: string;
  }> {
    return await this.page.evaluate(() => {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement;
      if (!canvas) {
        return {
          canvasFound: false,
          originalDimensions: { width: 0, height: 0 },
          displayedDimensions: { width: 0, height: 0 },
          targetDimensions: { width: 1080, height: 1920 },
          needsVirtualCanvas: false,
          reason: 'No canvas found'
        };
      }

      const rect = canvas.getBoundingClientRect();
      const targetWidth = 1080;
      const targetHeight = 1920;
      
      const dimensionsMismatch = Math.abs(canvas.width - targetWidth) > 50 || 
                               Math.abs(canvas.height - targetHeight) > 50;
      const constrainedByParent = rect.width < canvas.width * 0.9 || 
                                rect.height < canvas.height * 0.9;
      
      let reason = '';
      if (dimensionsMismatch) {
        reason = `Canvas dimensions ${canvas.width}x${canvas.height} don't match target ${targetWidth}x${targetHeight}`;
      } else if (constrainedByParent) {
        reason = `Canvas is constrained by parent (displayed: ${rect.width}x${rect.height}, actual: ${canvas.width}x${canvas.height})`;
      }

      return {
        canvasFound: true,
        originalDimensions: { width: canvas.width, height: canvas.height },
        displayedDimensions: { width: rect.width, height: rect.height },
        targetDimensions: { width: targetWidth, height: targetHeight },
        needsVirtualCanvas: dimensionsMismatch || constrainedByParent,
        reason: reason || 'Canvas dimensions are acceptable'
      };
    });
  }
}
