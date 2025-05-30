/**
 * Configuration options for recording Figma prototype flows.
 * Supports both video recording and frame-by-frame capture modes.
 */
export interface RecordingOptions {
  /** The Figma prototype URL to record */
  figmaUrl: string;
  
  /** Recording mode: 'video' for real-time recording, 'frames' for frame-by-frame capture */
  recordingMode: 'video' | 'frames';
  
  /** Recording duration in seconds (optional for manual stop mode) */
  duration?: number;
  
  /** Frame rate for frame capture mode (default: 10 fps) */
  frameRate?: number;
  
  /** Output format: 'mp4', 'webm', or 'gif' for video, 'png' for frames */
  format: 'mp4' | 'webm' | 'gif' | 'png';
  
  /** Custom output width in pixels (overrides preset resolutions) */
  customWidth?: number;
  
  /** Custom output height in pixels (overrides preset resolutions) */
  customHeight?: number;
  
  /** Whether to wait for canvas detection before starting */
  waitForCanvas?: boolean;
  
  /** Stop mode: 'timer' for automatic stop, 'manual' for user control */
  stopMode?: 'timer' | 'manual';
  
  /** Whether to scale canvas content to fit specified dimensions */
  scaleToFit?: boolean;
}

/**
 * Result object returned after completing a recording operation.
 * Contains success status, output information, and error details if any.
 */
export interface RecordingResult {
  /** Whether the recording completed successfully */
  success: boolean;
  
  /** Path to the output file (video or directory for frames) */
  outputPath?: string;
  
  /** Total recording duration in seconds */
  duration?: number;
  
  /** Number of frames captured (for frame mode) */
  frameCount?: number;
  
  /** Actual resolution of the recorded content */
  actualResolution?: Resolution;
  
  /** Error message if recording failed */
  error?: string;
}

/**
 * Information about the detected Figma canvas element.
 * Used for optimizing capture area and positioning.
 */
export interface CanvasInfo {
  /** Whether a canvas element was successfully detected */
  detected: boolean;
  
  /** Canvas bounding box coordinates and dimensions */
  bounds?: {
    /** X coordinate relative to viewport */
    x: number;
    /** Y coordinate relative to viewport */
    y: number;
    /** Canvas width in pixels */
    width: number;
    /** Canvas height in pixels */
    height: number;
  };
}

/**
 * Simple resolution specification with width and height dimensions.
 */
export interface Resolution {
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
}
