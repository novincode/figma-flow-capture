export interface RecordingOptions {
  figmaUrl: string;
  recordingMode: 'video' | 'frames';
  stopMode: 'timer' | 'manual';
  duration?: number;
  frameRate: number;
  waitForCanvas: boolean;
  autoResize: boolean;
  customWidth?: number;
  customHeight?: number;
  format: 'webm' | 'mp4';
}

export interface RecordingResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  duration?: number;
  frameCount?: number;
  actualResolution?: {
    width: number;
    height: number;
  };
}

export interface CanvasInfo {
  detected: boolean;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  frameSize?: {
    width: number;
    height: number;
  };
}

export interface FrameTiming {
  frameNumber: number;
  timestamp: number;
  duration: number;
}
