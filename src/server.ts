import express from 'express';
import cors from 'cors';
import { FigmaRecorder } from './core/recorder';
import { RecordingOptions } from './types/recording';
import { checkFFmpegAvailability } from './utils/ffmpeg-checker';
import { logger } from './utils/logger';
import { DependencyManager } from './utils/dependency-manager';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = process.env.PORT || 8787;

// Initialize dependency manager
const dependencyManager = DependencyManager.getInstance();

// Middleware
app.use(cors());
app.use(express.json());

// Store active recording sessions
interface RecordingSession {
  id: string;
  recorder: FigmaRecorder;
  status: 'preparing' | 'recording' | 'processing' | 'stopping' | 'completed' | 'failed';
  startTime: Date;
  endTime?: Date;
  options: RecordingOptions;
  outputPath?: string;
  error?: string;
}

const activeSessions = new Map<string, RecordingSession>();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    activeSessions: activeSessions.size
  });
});

// Check system dependencies
app.get('/dependencies', async (req, res) => {
  try {
    // Check FFmpeg
    const ffmpegAvailable = await checkFFmpegAvailability();
    
    // Check if recordings directory exists
    const recordingsDir = path.join(process.cwd(), 'recordings');
    let recordingsExists = false;
    try {
      await fs.access(recordingsDir);
      recordingsExists = true;
    } catch {
      // Directory doesn't exist, we'll create it when needed
    }

    const dependencies = {
      ffmpeg: {
        installed: ffmpegAvailable,
        version: ffmpegAvailable ? 'Available' : null
      },
      nodejs: {
        installed: true,
        version: process.version
      },
      recordingsDirectory: {
        exists: recordingsExists,
        path: recordingsDir
      }
    };

    res.json({
      dependencies,
      ready: ffmpegAvailable,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error checking dependencies:', error);
    res.status(500).json({ 
      error: 'Failed to check dependencies',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Start recording
app.post('/recording/start', async (req, res) => {
  try {
    const options: RecordingOptions = req.body;
    
    // Validate required fields
    if (!options.figmaUrl) {
      return res.status(400).json({ error: 'figmaUrl is required' });
    }

    // Set default values for optional fields
    const recordingOptions: RecordingOptions = {
      figmaUrl: options.figmaUrl,
      recordingMode: options.recordingMode || 'video',
      format: options.format || 'mp4',
      // Only set default duration if in timer mode, leave undefined for manual mode
      duration: options.stopMode === 'timer' ? (options.duration || 15) : options.duration,
      frameRate: options.frameRate || 30,
      waitForCanvas: options.waitForCanvas !== undefined ? options.waitForCanvas : true,
      customWidth: options.customWidth,
      customHeight: options.customHeight,
      stopMode: options.stopMode || 'timer',
      scaleToFit: options.scaleToFit || false,
      figmaScaling: options.figmaScaling || 'scale-down-width',
      figmaContentScaling: options.figmaContentScaling || 'fixed'
    };

    // Generate session ID
    const sessionId = uuidv4();
    
    // Create recorder instance
    const recorder = new FigmaRecorder();
    
    // Create session
    const session: RecordingSession = {
      id: sessionId,
      recorder,
      status: 'preparing',
      startTime: new Date(),
      options: recordingOptions
    };
    
    activeSessions.set(sessionId, session);
    
    logger.info(`Starting recording session ${sessionId} for URL: ${options.figmaUrl}`);
    
    // Start recording asynchronously
    recordingProcess(session).catch(error => {
      logger.error(`Recording session ${sessionId} failed:`, error);
      session.status = 'failed';
      session.error = error instanceof Error ? error.message : 'Unknown error';
    });
    
    res.json({
      sessionId,
      status: 'preparing',
      startTime: session.startTime.toISOString(),
      message: 'Recording session started'
    });
    
  } catch (error) {
    logger.error('Error starting recording:', error);
    res.status(500).json({ 
      error: 'Failed to start recording',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Helper function to stop a recording session
async function stopRecordingSession(sessionId: string, requireRecordingStatus: boolean = false): Promise<{ success: boolean; data?: any; error?: string; statusCode?: number }> {
  try {
    const session = activeSessions.get(sessionId);
    
    if (!session) {
      return { success: false, error: 'Recording session not found', statusCode: 404 };
    }
    
    if (session.status === 'completed' || session.status === 'failed') {
      return { 
        success: true,
        data: { 
          message: 'Recording already stopped',
          sessionId,
          status: session.status,
          outputPath: session.outputPath
        }
      };
    }
    
    if (requireRecordingStatus && session.status !== 'recording') {
      return { success: false, error: 'Session is not currently recording', statusCode: 400 };
    }
    
    logger.info(`Stopping recording session ${sessionId}`);
    
    // Stop the recorder gracefully
    session.status = 'stopping';
    await session.recorder.stopRecording();
    
    // Close the page and clean up browser resources
    await session.recorder.closePage();
    
    // Mark as completed after successful stop
    session.status = 'completed';
    session.endTime = new Date();
    
    // Remove the session from active sessions to ensure proper cleanup
    activeSessions.delete(sessionId);
    logger.info(`Session ${sessionId} removed from active sessions. Remaining sessions: ${activeSessions.size}`);
    
    return {
      success: true,
      data: {
        message: 'Recording stopped successfully',
        sessionId,
        status: session.status,
        outputPath: session.outputPath
      }
    };
    
  } catch (error) {
    logger.error('Error stopping recording:', error);
    return {
      success: false,
      error: 'Failed to stop recording',
      statusCode: 500,
      data: { details: error instanceof Error ? error.message : 'Unknown error' }
    };
  }
}

// Stop recording
app.post('/recording/:sessionId/stop', async (req, res) => {
  const { sessionId } = req.params;
  const result = await stopRecordingSession(sessionId, false);
  
  if (result.success) {
    res.json(result.data);
  } else {
    res.status(result.statusCode || 500).json({ 
      error: result.error,
      ...(result.data || {})
    });
  }
});

// Stop a recording session (alias for backwards compatibility)
app.post('/session/:sessionId/stop', async (req, res) => {
  const { sessionId } = req.params;
  const result = await stopRecordingSession(sessionId, true);
  
  if (result.success) {
    res.json({
      message: 'Session stopped successfully',
      sessionId,
      status: result.data?.status
    });
  } else {
    res.status(result.statusCode || 500).json({ 
      error: result.error,
      ...(result.data || {})
    });
  }
});

// Get recording status
app.get('/recording/:sessionId/status', (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = activeSessions.get(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Recording session not found' });
    }
    
    const response: any = {
      sessionId,
      status: session.status,
      startTime: session.startTime.toISOString(),
      options: session.options
    };
    
    if (session.outputPath) {
      response.outputPath = session.outputPath;
    }
    
    if (session.error) {
      response.error = session.error;
    }
    
    if (session.status === 'completed') {
      response.duration = (new Date().getTime() - session.startTime.getTime()) / 1000;
    }
    
    res.json(response);
    
  } catch (error) {
    logger.error('Error getting recording status:', error);
    res.status(500).json({ 
      error: 'Failed to get recording status',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// List all recordings
app.get('/recordings', async (req, res) => {
  try {
    const recordingsDir = path.join(process.cwd(), 'recordings');
    
    try {
      const entries = await fs.readdir(recordingsDir, { withFileTypes: true });
      const recordings = [];
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const recordingPath = path.join(recordingsDir, entry.name);
          const stats = await fs.stat(recordingPath);
          
          // Check for recording files and determine video format
          const files = await fs.readdir(recordingPath);
          
          // Check for video files and determine format
          const videoFile = files.find(file => 
            file.endsWith('.mp4') || 
            file.endsWith('.webm') || 
            file.endsWith('.gif')
          );
          
          const hasVideo = !!videoFile;
          const hasFrames = files.includes('frames');
          
          // Extract video format from filename
          let videoFormat = null;
          if (videoFile) {
            const extension = videoFile.split('.').pop()?.toUpperCase();
            videoFormat = extension;
          }
          
          recordings.push({
            name: entry.name,
            path: recordingPath,
            createdAt: stats.birthtime.toISOString(),
            modifiedAt: stats.mtime.toISOString(),
            hasVideo,
            hasFrames,
            videoFormat // Add video format to the response
          });
        }
      }
      
      // Sort by creation date (newest first)
      recordings.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      res.json({ recordings });
      
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        res.json({ recordings: [] });
      } else {
        throw error;
      }
    }
    
  } catch (error) {
    logger.error('Error listing recordings:', error);
    res.status(500).json({ 
      error: 'Failed to list recordings',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Delete recording
app.delete('/recording/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const recordingsDir = path.join(process.cwd(), 'recordings');
    const recordingPath = path.join(recordingsDir, name);
    
    // Security check - ensure the path is within recordings directory
    if (!recordingPath.startsWith(recordingsDir)) {
      return res.status(400).json({ error: 'Invalid recording name' });
    }
    
    await fs.rm(recordingPath, { recursive: true, force: true });
    
    res.json({ message: 'Recording deleted successfully' });
    
  } catch (error) {
    logger.error('Error deleting recording:', error);
    res.status(500).json({ 
      error: 'Failed to delete recording',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Clear/delete a recording session
app.delete('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = activeSessions.get(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Recording session not found' });
    }
    
    logger.info(`Clearing recording session ${sessionId}`);
    
    // Stop the recorder if it's still running using our helper function
    if (session.status === 'recording' || session.status === 'preparing') {
      const stopResult = await stopRecordingSession(sessionId, false);
      if (!stopResult.success) {
        logger.warn(`Failed to stop recorder while clearing session ${sessionId}: ${stopResult.error}`);
      }
    } else {
      // If not recording, just do cleanup
      try {
        await session.recorder.cleanup();
      } catch (error) {
        logger.warn(`Failed to cleanup recorder while clearing session ${sessionId}:`, error);
      }
      
      // Remove from active sessions if not already removed
      activeSessions.delete(sessionId);
    }
    
    res.json({ 
      message: 'Session cleared successfully',
      sessionId
    });
    
  } catch (error) {
    logger.error('Error clearing session:', error);
    res.status(500).json({ 
      error: 'Failed to clear session',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get server info
app.get('/info', (req, res) => {
  res.json({
    name: 'Figma Flow Capture API Server',
    version: '1.0.0',
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    pid: process.pid,
    activeSessions: activeSessions.size,
    timestamp: new Date().toISOString()
  });
});

// Get active sessions
app.get('/sessions/active', (req, res) => {
  try {
    const sessions = Array.from(activeSessions.values()).map(session => ({
      sessionId: session.id,
      name: `Recording ${session.id.substring(0, 8)}`, // Generate a display name
      startTime: session.startTime.toISOString(),
      recordingMode: session.options.recordingMode || 'video',
      status: session.status,
      figmaUrl: session.options.figmaUrl,
      duration: session.options.duration,
      width: session.options.customWidth || 1920,
      height: session.options.customHeight || 1080
    }));
    
    res.json({ sessions });
    
  } catch (error) {
    logger.error('Error getting active sessions:', error);
    res.status(500).json({ 
      error: 'Failed to get active sessions',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// System management endpoints for automatic setup

// Get detailed system information
app.get('/system/info', async (req, res) => {
  try {
    const systemInfo = await dependencyManager.getSystemInfo();
    res.json({ success: true, data: systemInfo });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Check all system dependencies
app.get('/system/dependencies', async (req, res) => {
  try {
    const dependencies = await dependencyManager.checkAllDependencies();
    res.json({ success: true, data: dependencies });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Install specific dependency
app.post('/system/install/:dependency', async (req, res) => {
  try {
    const { dependency } = req.params;
    const result = await dependencyManager.installDependency(dependency);
    res.json({ success: result.success, message: result.message, output: result.output });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Install all missing dependencies
app.post('/system/install-all', async (req, res) => {
  try {
    const result = await dependencyManager.installAllMissing();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Setup project (clone and install)
app.post('/system/setup-project', async (req, res) => {
  try {
    const { repoUrl } = req.body;
    const result = await dependencyManager.setupProject(repoUrl);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start the core server
app.post('/system/start-server', async (req, res) => {
  try {
    const result = await dependencyManager.startServer();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Recording process handler
async function recordingProcess(session: RecordingSession) {
  try {
    session.status = 'recording';
    logger.info(`Recording process started for session ${session.id}`);
    
    // Ensure recordings directory exists
    const recordingsDir = path.join(process.cwd(), 'recordings');
    await fs.mkdir(recordingsDir, { recursive: true });
    
    // Initialize the recorder
    await session.recorder.initialize();
    
    // Start the recording
    const result = await session.recorder.startRecording(session.options);
    
    // Check if session was manually stopped during recording by checking current status
    const currentSession = activeSessions.get(session.id);
    if (!currentSession || currentSession.status === 'completed' || currentSession.status === 'stopping') {
      logger.info(`Recording session ${session.id} was stopped manually, skipping result processing`);
      return;
    }
    
    if (result.success) {
      session.outputPath = result.outputPath;
      logger.info(`Recording session ${session.id} completed successfully`);
      
      // Only mark as completed if not already stopped/failed externally
      if (session.status === 'recording') {
        session.status = 'completed';
        session.endTime = new Date();
      }
    } else {
      session.status = 'failed';
      session.error = result.error;
      logger.error(`Recording session ${session.id} failed to start: ${result.error}`);
    }
  } catch (error) {
    // Only set failed status if not already completed/stopped
    if (session.status === 'recording') {
      session.status = 'failed';
      session.error = error instanceof Error ? error.message : 'Unknown error';
    }
    logger.error(`Error in recording process for session ${session.id}:`, error);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully...');
  
  // Stop all active recordings using our helper function
  const stopPromises = Array.from(activeSessions.keys()).map(async (sessionId) => {
    try {
      logger.info(`Stopping recording session ${sessionId}...`);
      const result = await stopRecordingSession(sessionId, false);
      if (!result.success) {
        logger.warn(`Failed to stop session ${sessionId}: ${result.error}`);
      }
    } catch (error) {
      logger.warn(`Error stopping session ${sessionId}:`, error);
    }
  });
  
  await Promise.all(stopPromises);
  
  logger.info('All recordings stopped. Exiting now.');
  process.exit(0);
});

// Error handling middleware
app.use((err: any, req: any, res: any, next: any) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    details: err instanceof Error ? err.message : 'Unknown error'
  });
});

app.listen(PORT, () => {
  logger.info(`Server is running on http://localhost:${PORT}`);
});
