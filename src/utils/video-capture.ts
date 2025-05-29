import { Page } from 'playwright';
import { logger } from './logger.js';

export class VideoCapture {
  private isRecording = false;
  private recordingData: Blob[] = [];

  constructor(private page: Page) {}

  async startRecording(): Promise<void> {
    if (this.isRecording) {
      throw new Error('Recording already in progress');
    }

    this.isRecording = true;
    this.recordingData = [];

    logger.info('Starting browser media recording...');

    // Inject MediaRecorder-based recording
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

          // Get canvas stream with specific frame rate
          const stream = canvas.captureStream(30); // 30 FPS
          
          // Verify stream has tracks
          if (stream.getVideoTracks().length === 0) {
            reject(new Error('No video tracks in canvas stream'));
            return;
          }

          // Try different codec options for Firefox compatibility
          let mediaRecorder: MediaRecorder;
          const codecOptions = [
            'video/webm;codecs=vp8', // Most compatible with Firefox
            'video/webm;codecs=vp9',
            'video/webm',
            ''  // Let browser choose
          ];

          let codecUsed = 'unknown';
          for (const codec of codecOptions) {
            try {
              if (codec === '' || MediaRecorder.isTypeSupported(codec)) {
                const options: MediaRecorderOptions = {};
                if (codec) {
                  options.mimeType = codec;
                }
                // Add bitrate for better quality
                options.videoBitsPerSecond = 2500000; // 2.5 Mbps
                
                mediaRecorder = new MediaRecorder(stream, options);
                codecUsed = codec || 'browser-default';
                console.log(`Using codec: ${codecUsed}`);
                break;
              }
            } catch (e) {
              continue;
            }
          }

          if (!mediaRecorder!) {
            throw new Error('No supported codec found for MediaRecorder');
          }

          const chunks: Blob[] = [];

          mediaRecorder.ondataavailable = (event) => {
            console.log('Data available:', event.data.size, 'bytes');
            if (event.data.size > 0) {
              chunks.push(event.data);
            }
          };

          mediaRecorder.onstop = () => {
            console.log('Recording stopped, chunks:', chunks.length);
            if (chunks.length === 0) {
              console.error('No recording data collected');
              (window as any).recordingError = 'No recording data found';
              return;
            }
            
            const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'video/webm' });
            console.log('Created blob:', blob.size, 'bytes');
            // Store the blob data in window for retrieval
            (window as any).recordingBlob = blob;
          };

          mediaRecorder.onerror = (event) => {
            console.error('MediaRecorder error:', event);
            (window as any).recordingError = 'MediaRecorder failed';
          };

          mediaRecorder.onstart = () => {
            console.log('MediaRecorder started');
          };

          // Store recorder in window for later access
          (window as any).mediaRecorder = mediaRecorder;
          (window as any).recordingChunks = chunks;
          
          // Start recording with smaller chunk intervals for more reliable data collection
          mediaRecorder.start(500); // Collect data every 500ms
          
          // Ensure the canvas is actively rendering
          const context = canvas.getContext('2d');
          if (context) {
            // Force a repaint by drawing something minimal
            const originalCompositeOperation = context.globalCompositeOperation;
            context.globalCompositeOperation = 'source-over';
            context.globalCompositeOperation = originalCompositeOperation;
          }
          
          resolve();

        } catch (error) {
          reject(error);
        }
      });
    });
  }

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
          // Already stopped, check for blob
          const blob = (window as any).recordingBlob;
          if (blob && blob.size > 0) {
            blob.arrayBuffer().then((arrayBuffer: ArrayBuffer) => {
              const uint8Array = new Uint8Array(arrayBuffer);
              resolve(uint8Array);
            }).catch(reject);
          } else {
            reject(new Error('No recording data found - recording may have failed'));
          }
          return;
        }

        mediaRecorder.onstop = async () => {
          try {
            // Wait a bit for the blob to be ready
            await new Promise(resolve => setTimeout(resolve, 100));
            
            const blob = (window as any).recordingBlob;
            if (blob && blob.size > 0) {
              console.log('Converting blob to array buffer, size:', blob.size);
              const arrayBuffer = await blob.arrayBuffer();
              const uint8Array = new Uint8Array(arrayBuffer);
              console.log('Converted to Uint8Array, length:', uint8Array.length);
              resolve(uint8Array);
            } else {
              const chunks = (window as any).recordingChunks;
              console.log('No blob found, chunks available:', chunks ? chunks.length : 0);
              
              if (chunks && chunks.length > 0) {
                // Try to create blob from chunks directly
                const finalBlob = new Blob(chunks, { type: mediaRecorder.mimeType || 'video/webm' });
                if (finalBlob.size > 0) {
                  const arrayBuffer = await finalBlob.arrayBuffer();
                  const uint8Array = new Uint8Array(arrayBuffer);
                  resolve(uint8Array);
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

        // Force data collection before stopping
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.requestData();
          // Give it a moment to collect data
          setTimeout(() => {
            mediaRecorder.stop();
          }, 100);
        } else {
          mediaRecorder.stop();
        }
      });
    });

    return recordingData;
  }

  isActive(): boolean {
    return this.isRecording;
  }
}
