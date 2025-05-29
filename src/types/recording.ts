export interface RecordingOptions {
  url: string;
  outputDir?: string;
  duration?: number;
  viewport?: {
    width: number;
    height: number;
  };
  quality?: 'low' | 'medium' | 'high' | 'instagram-story' | 'instagram-reel' | 'tiktok' | 'youtube-shorts' | 'custom';
  format?: 'webm' | 'mp4';
  recordingMode?: 'video' | 'frames';
  stopMode?: 'timer' | 'manual' | 'auto-detect';
  frameRate?: number;
  waitForCanvas?: boolean;
  autoResize?: boolean;
  customWidth?: number;
  customHeight?: number;
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
