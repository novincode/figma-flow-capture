export interface SystemDependency {
  name: string;
  installed: boolean;
  version?: string;
  install_command?: string;
  install_url?: string;
}

export interface DependencyInfo {
  installed: boolean;
  version: string | null;
}

export interface DependencyStatus {
  nodejs: DependencyInfo;
  pnpm: DependencyInfo;
  ffmpeg: DependencyInfo;
  browsers: DependencyInfo;
}

export interface RecordingSession {
  id: string;
  status: 'preparing' | 'recording' | 'processing' | 'completed' | 'failed';
  start_time: string;
  duration?: number;
  output_path?: string;
  error?: string;
}

export interface RecordingOptions {
  figma_url: string;
  recording_mode: 'video' | 'frames';
  quality: string;
  custom_width?: number;
  custom_height?: number;
  duration?: number;
  format: string;
  frame_rate?: number;
  wait_for_canvas: boolean;
}

export interface RecordingResult {
  success: boolean;
  output_path?: string;
  duration?: number;
  frame_count?: number;
  error?: string;
}

export interface InstallationStatus {
  dependencies: SystemDependency[];
  ready_to_record: boolean;
  project_path: string;
}

export interface ResolutionPreset {
  name: string;
  width: number;
  height: number;
  description: string;
}

export const RESOLUTION_PRESETS: Record<string, ResolutionPreset> = {
  'high-quality': { name: 'High Quality', width: 1920, height: 1080, description: '1080p - Best for presentations' },
  'instagram-story': { name: 'Instagram Story', width: 1080, height: 1920, description: 'Vertical 9:16 - Perfect for stories' },
  'tiktok': { name: 'TikTok/Reels', width: 1080, height: 1920, description: 'Vertical video for social media' },
  'youtube': { name: 'YouTube', width: 1920, height: 1080, description: 'Standard YouTube format' },
  'square': { name: 'Square', width: 1080, height: 1080, description: '1:1 ratio for Instagram posts' },
  'custom': { name: 'Custom', width: 1920, height: 1080, description: 'Enter your own dimensions' }
};
