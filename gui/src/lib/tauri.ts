import { invoke } from '@tauri-apps/api/core';
import { 
  RecordingOptions, 
  InstallationStatus,
  DependencyStatus,
  RecordingSession
} from '../types';

export class TauriAPI {
  static async checkSystemDependencies(): Promise<InstallationStatus> {
    return await invoke('check_system_dependencies');
  }

  static async checkDependencies(): Promise<DependencyStatus> {
    return await invoke('check_dependencies');
  }

  static async installDependencies(): Promise<string> {
    return await invoke('install_dependencies');
  }

  static async installPlaywrightBrowsers(): Promise<string> {
    return await invoke('install_playwright_browsers');
  }

  static async startRecording(options: RecordingOptions): Promise<RecordingSession> {
    return await invoke('start_recording', { options });
  }

  static async stopRecording(sessionId: string): Promise<void> {
    return await invoke('stop_recording', { session_id: sessionId });
  }

  static async openRecordingsFolder(): Promise<void> {
    return await invoke('open_recordings_folder');
  }

  static async greet(name: string): Promise<string> {
    return await invoke('greet', { name });
  }
}

export const tauriAPI = TauriAPI;
