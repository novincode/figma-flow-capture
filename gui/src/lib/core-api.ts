// Core API service for interacting with the main TypeScript recorder
// This provides a clean interface between the GUI and the core recording functionality

import { RecordingOptions, RecordingSession, DependencyStatus } from '../types';

export class CoreAPI {
  private baseUrl: string;
  private isElectron: boolean;

  constructor() {
    // Detect if we're running in Tauri (desktop) or browser
    this.isElectron = typeof window !== 'undefined' && (window as any).__TAURI__ !== undefined;
    this.baseUrl = this.isElectron ? '' : 'http://localhost:3001/api'; // Fallback for web version
  }

  /**
   * Check system dependencies status
   */
  async checkDependencies(): Promise<DependencyStatus> {
    if (this.isElectron) {
      // Use Tauri commands for desktop app
      return await (window as any).__TAURI__.core.invoke('check_dependencies');
    } else {
      // Fallback to HTTP API for web version
      const response = await fetch(`${this.baseUrl}/dependencies`);
      return await response.json();
    }
  }

  /**
   * Start a recording session
   */
  async startRecording(options: RecordingOptions): Promise<RecordingSession> {
    if (this.isElectron) {
      // Use Tauri commands for desktop app
      return await (window as any).__TAURI__.core.invoke('start_recording', { options });
    } else {
      // Fallback to HTTP API for web version
      const response = await fetch(`${this.baseUrl}/recording/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options)
      });
      return await response.json();
    }
  }

  /**
   * Stop a recording session
   */
  async stopRecording(sessionId: string): Promise<void> {
    if (this.isElectron) {
      // Use Tauri commands for desktop app
      return await (window as any).__TAURI__.core.invoke('stop_recording', { sessionId });
    } else {
      // Fallback to HTTP API for web version
      await fetch(`${this.baseUrl}/recording/${sessionId}/stop`, {
        method: 'POST'
      });
    }
  }

  /**
   * Get recording session status
   */
  async getRecordingStatus(sessionId: string): Promise<RecordingSession> {
    if (this.isElectron) {
      // For Tauri, we'll need to implement this command
      return await (window as any).__TAURI__.core.invoke('get_recording_status', { sessionId });
    } else {
      // Fallback to HTTP API for web version
      const response = await fetch(`${this.baseUrl}/recording/${sessionId}`);
      return await response.json();
    }
  }

  /**
   * List all recordings
   */
  async listRecordings(): Promise<Array<{ name: string; path: string; size: number; created: string }>> {
    if (this.isElectron) {
      return await (window as any).__TAURI__.core.invoke('list_recordings');
    } else {
      const response = await fetch(`${this.baseUrl}/recordings`);
      return await response.json();
    }
  }

  /**
   * Open recordings folder
   */
  async openRecordingsFolder(): Promise<void> {
    if (this.isElectron) {
      return await (window as any).__TAURI__.core.invoke('open_recordings_folder');
    } else {
      // For web version, download or open in new tab
      window.open(`${this.baseUrl}/recordings/folder`, '_blank');
    }
  }

  /**
   * Install missing dependencies
   */
  async installDependencies(): Promise<string> {
    if (this.isElectron) {
      return await (window as any).__TAURI__.core.invoke('install_dependencies');
    } else {
      const response = await fetch(`${this.baseUrl}/dependencies/install`, {
        method: 'POST'
      });
      const result = await response.json();
      return result.message;
    }
  }

  /**
   * Install Playwright browsers
   */
  async installPlaywrightBrowsers(): Promise<string> {
    if (this.isElectron) {
      return await (window as any).__TAURI__.core.invoke('install_playwright_browsers');
    } else {
      const response = await fetch(`${this.baseUrl}/dependencies/browsers`, {
        method: 'POST'
      });
      const result = await response.json();
      return result.message;
    }
  }
}

// Export a singleton instance
export const coreAPI = new CoreAPI();
