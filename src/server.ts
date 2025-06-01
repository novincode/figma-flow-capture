import express from 'express';
import cors from 'cors';
import { FigmaRecorder } from './core/recorder';
import { RecordingOptions } from './types/recording';
import { checkFFmpegAvailability } from './utils/ffmpeg-checker';
import { logger } from './utils/logger';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = process.env.PORT || 8787;

// Middleware
app.use(cors());
app.use(express.json());

// Store active recording sessions
interface RecordingSession {
  id: string;
  recorder: FigmaRecorder;
  status: 'preparing' | 'recording' | 'processing' | 'completed' | 'failed';
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
      stopMode: options.stopMode || 'timer'
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

// Stop recording
app.post('/recording/:sessionId/stop', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = activeSessions.get(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Recording session not found' });
    }
    
    if (session.status === 'completed' || session.status === 'failed') {
      return res.json({ 
        message: 'Recording already stopped',
        status: session.status,
        outputPath: session.outputPath
      });
    }
    
    logger.info(`Stopping recording session ${sessionId}`);
    
    // Stop the recorder gracefully
    session.status = 'processing';
    await session.recorder.stopRecording();
    
    res.json({ 
      message: 'Recording stopped successfully',
      sessionId,
      status: 'processing'
    });
    
  } catch (error) {
    logger.error('Error stopping recording:', error);
    res.status(500).json({ 
      error: 'Failed to stop recording',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Stop a recording session (without deleting)
app.post('/session/:sessionId/stop', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = activeSessions.get(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Recording session not found' });
    }
    
    if (session.status !== 'recording') {
      return res.status(400).json({ error: 'Session is not currently recording' });
    }
    
    logger.info(`Stopping recording session ${sessionId}`);
    
    // Stop the recorder
    const result = await session.recorder.stopRecording();
    session.status = 'completed';
    session.endTime = new Date();
    
    res.json({ 
      message: 'Session stopped successfully',
      sessionId,
      result
    });
    
  } catch (error) {
    logger.error('Error stopping session:', error);
    res.status(500).json({ 
      error: 'Failed to stop session',
      details: error instanceof Error ? error.message : 'Unknown error'
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
          
          // Check for recording files
          const files = await fs.readdir(recordingPath);
          const hasVideo = files.some(file => file.endsWith('.mp4') || file.endsWith('.webm'));
          const hasFrames = files.includes('frames');
          
          recordings.push({
            name: entry.name,
            path: recordingPath,
            createdAt: stats.birthtime.toISOString(),
            modifiedAt: stats.mtime.toISOString(),
            hasVideo,
            hasFrames
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
    
    // Stop the recorder if it's still running
    if (session.status === 'recording' || session.status === 'preparing') {
      try {
        await session.recorder.stopRecording();
      } catch (error) {
        logger.warn(`Failed to stop recorder while clearing session ${sessionId}:`, error);
      }
    }
    
    // Cleanup the recorder
    try {
      await session.recorder.cleanup();
    } catch (error) {
      logger.warn(`Failed to cleanup recorder while clearing session ${sessionId}:`, error);
    }
    
    // Remove from active sessions
    activeSessions.delete(sessionId);
    
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
      duration: session.options.duration
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
    
    if (result.success) {
      session.status = 'completed';
      session.outputPath = result.outputPath;
      logger.info(`Recording completed for session ${session.id}: ${result.outputPath}`);
    } else {
      session.status = 'failed';
      session.error = result.error || 'Recording failed without specific error';
      logger.error(`Recording failed for session ${session.id}: ${session.error}`);
    }
    
  } catch (error) {
    session.status = 'failed';
    session.error = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Recording failed for session ${session.id}:`, error);
  } finally {
    // Always cleanup the recorder
    try {
      await session.recorder.cleanup();
    } catch (cleanupError) {
      logger.error(`Cleanup failed for session ${session.id}:`, cleanupError);
    }
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  
  // Stop all active recordings
  for (const [sessionId, session] of activeSessions) {
    if (session.status === 'recording') {
      logger.info(`Stopping recording session ${sessionId} due to shutdown`);
      try {
        await session.recorder.stopRecording();
        await session.recorder.cleanup();
      } catch (error) {
        logger.error(`Error stopping session ${sessionId}:`, error);
      }
    }
  }
  
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  
  // Stop all active recordings
  for (const [sessionId, session] of activeSessions) {
    if (session.status === 'recording') {
      logger.info(`Stopping recording session ${sessionId} due to shutdown`);
      try {
        await session.recorder.stopRecording();
        await session.recorder.cleanup();
      } catch (error) {
        logger.error(`Error stopping session ${sessionId}:`, error);
      }
    }
  }
  
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  logger.info(`🚀 Figma Flow Capture API Server running on http://localhost:${PORT}`);
  logger.info(`📁 Recordings directory: ${path.join(process.cwd(), 'recordings')}`);
  logger.info(`🔧 Node.js version: ${process.version}`);
  logger.info(`🖥️  Platform: ${process.platform} ${process.arch}`);
});

export default app;
