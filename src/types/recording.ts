export interface RecordingOptions {
  figmaUrl: string;
  recordingMode: 'video' | 'frames';
  duration?: number;
  frameRate?: number;
  format: 'mp4' | 'webm' | 'png';
  customWidth?: number;
  customHeight?: number;
  waitForCanvas?: boolean;
  stopMode?: 'timer' | 'manual';
}

export interface RecordingResult {
  success: boolean;
  outputPath?: string;
  duration?: number;
  frameCount?: number;
  actualResolution?: Resolution;
  error?: string;
}

export interface CanvasInfo {
  detected: boolean;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface Resolution {
  width: number;
  height: number;
}
