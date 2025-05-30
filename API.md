# Figma Flow Capture API Documentation

## Overview

The Figma Flow Capture API Server is a RESTful API that enables programmatic recording of Figma prototype flows. It provides endpoints for starting recordings, monitoring progress, managing sessions, and retrieving recorded content.

## Base URL

```
http://localhost:3001
```

> **Note:** The default port is 3001, but can be changed via the `PORT` environment variable.

## API Endpoints

### 🏥 Health Check

#### `GET /health`

Check if the API server is running and responsive.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-05-30T13:02:23.023Z",
  "activeSessions": 0
}
```

---

### 🔧 System Dependencies

#### `GET /dependencies`

Check system dependencies and readiness status.

**Response:**
```json
{
  "dependencies": {
    "ffmpeg": {
      "installed": true,
      "version": "Available"
    },
    "nodejs": {
      "installed": true,
      "version": "v20.19.0"
    },
    "recordingsDirectory": {
      "exists": true,
      "path": "/path/to/recordings"
    }
  },
  "ready": true,
  "timestamp": "2025-05-30T13:02:23.023Z"
}
```

**Status Codes:**
- `200` - Dependencies checked successfully
- `500` - Error checking dependencies

---

### 🎬 Recording Management

#### `POST /recording/start`

Start a new recording session.

**Request Body:**
```json
{
  "figmaUrl": "https://www.figma.com/proto/your-prototype-url",
  "name": "my-recording",
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "quality": "high",
  "captureFrames": true
}
```

**Required Fields:**
- `figmaUrl` (string) - The Figma prototype URL to record

**Optional Fields:**
- `name` (string) - Custom name for the recording
- `width` (number) - Recording width in pixels (default: 1920)
- `height` (number) - Recording height in pixels (default: 1080)
- `fps` (number) - Frames per second (default: 30)
- `quality` (string) - Recording quality: "low", "medium", "high" (default: "high")
- `captureFrames` (boolean) - Whether to save individual frames (default: false)

**Response:**
```json
{
  "sessionId": "uuid-v4-session-id",
  "status": "preparing",
  "startTime": "2025-05-30T13:02:23.023Z",
  "message": "Recording session started"
}
```

**Status Codes:**
- `200` - Recording started successfully
- `400` - Invalid request (missing figmaUrl)
- `500` - Server error

---

#### `POST /recording/:sessionId/stop`

Stop an active recording session.

**Parameters:**
- `sessionId` (string) - The session ID returned from `/recording/start`

**Response:**
```json
{
  "message": "Recording stopped successfully",
  "sessionId": "uuid-v4-session-id",
  "status": "processing"
}
```

**Status Codes:**
- `200` - Recording stopped successfully
- `404` - Session not found
- `500` - Server error

---

#### `GET /recording/:sessionId/status`

Get the current status of a recording session.

**Parameters:**
- `sessionId` (string) - The session ID

**Response:**
```json
{
  "sessionId": "uuid-v4-session-id",
  "status": "completed",
  "startTime": "2025-05-30T13:02:23.023Z",
  "options": {
    "figmaUrl": "https://www.figma.com/proto/...",
    "name": "my-recording",
    "width": 1920,
    "height": 1080
  },
  "outputPath": "/path/to/recording/output",
  "duration": 45.2
}
```

**Status Values:**
- `preparing` - Session is being initialized
- `recording` - Currently recording
- `processing` - Recording complete, processing video
- `completed` - Recording finished successfully
- `failed` - Recording failed (check `error` field)

**Status Codes:**
- `200` - Status retrieved successfully
- `404` - Session not found
- `500` - Server error

---

### 📁 Recording Files

#### `GET /recordings`

List all available recordings.

**Response:**
```json
{
  "recordings": [
    {
      "name": "my-recording-1748556297221",
      "path": "/path/to/recordings/my-recording-1748556297221",
      "createdAt": "2025-05-30T13:02:23.023Z",
      "modifiedAt": "2025-05-30T13:03:15.123Z",
      "hasVideo": true,
      "hasFrames": true
    }
  ]
}
```

**Status Codes:**
- `200` - Recordings listed successfully
- `500` - Server error

---

#### `DELETE /recording/:name`

Delete a recording and all its files.

**Parameters:**
- `name` (string) - The recording directory name

**Response:**
```json
{
  "message": "Recording deleted successfully"
}
```

**Status Codes:**
- `200` - Recording deleted successfully
- `400` - Invalid recording name
- `500` - Server error

---

### ℹ️ Server Information

#### `GET /info`

Get detailed server information.

**Response:**
```json
{
  "name": "Figma Flow Capture API Server",
  "version": "1.0.0",
  "node": "v20.19.0",
  "platform": "darwin",
  "arch": "arm64",
  "uptime": 3600.5,
  "memory": {
    "rss": 45678912,
    "heapTotal": 12345678,
    "heapUsed": 8765432,
    "external": 1234567,
    "arrayBuffers": 123456
  },
  "pid": 12345,
  "activeSessions": 2,
  "timestamp": "2025-05-30T13:02:23.023Z"
}
```

**Status Codes:**
- `200` - Information retrieved successfully

---

## Usage Examples

### Starting a Recording

```bash
curl -X POST http://localhost:3001/recording/start \
  -H "Content-Type: application/json" \
  -d '{
    "figmaUrl": "https://www.figma.com/proto/ABC123/My-Prototype",
    "name": "user-flow-demo",
    "width": 1920,
    "height": 1080,
    "captureFrames": true
  }'
```

### Checking Recording Status

```bash
curl http://localhost:3001/recording/550e8400-e29b-41d4-a716-446655440000/status
```

### Stopping a Recording

```bash
curl -X POST http://localhost:3001/recording/550e8400-e29b-41d4-a716-446655440000/stop
```

### Listing All Recordings

```bash
curl http://localhost:3001/recordings
```

---

## Error Handling

All endpoints return structured error responses:

```json
{
  "error": "Error description",
  "details": "Detailed error message"
}
```

### Common Error Codes

- `400` - Bad Request (missing required fields, invalid data)
- `404` - Not Found (session or recording not found)
- `500` - Internal Server Error (system errors, recording failures)

---

## Recording Process Flow

1. **Start Recording** - `POST /recording/start`
   - Returns session ID and status "preparing"

2. **Monitor Progress** - `GET /recording/:sessionId/status`
   - Status progresses: `preparing` → `recording` → `processing` → `completed`

3. **Stop Recording** (optional) - `POST /recording/:sessionId/stop`
   - Can be stopped manually or will complete automatically

4. **Access Files** - `GET /recordings`
   - List and access completed recordings

---

## Output Structure

Each recording creates a directory with the following structure:

```
recordings/
└── recording-name-timestamp/
    ├── recording.mp4          # Main video file
    └── frames/               # Individual frames (if captureFrames: true)
        ├── frame_000000.png
        ├── frame_000001.png
        └── ...
```

---

## Development & Deployment

### Starting the Server

```bash
# Development (with hot reload)
npm run server:dev

# Production
npm run server

# Custom port
PORT=8080 npm run server
```

### Environment Variables

- `PORT` - Server port (default: 3001)
- `NODE_ENV` - Environment mode (development/production)

### Dependencies

- **Node.js** v18+ required
- **FFmpeg** required for video processing
- **Playwright** browsers (auto-installed)

---

## Rate Limiting & Performance

- No built-in rate limiting (implement via reverse proxy if needed)
- Concurrent recordings are supported but resource-intensive
- Each recording session consumes significant CPU and memory
- Monitor system resources when running multiple recordings

---

## Security Considerations

- No authentication/authorization built-in
- Consider implementing API keys for production use
- Validate Figma URLs to prevent SSRF attacks
- Run behind reverse proxy with proper security headers
- Limit recording duration to prevent resource exhaustion

---

## Contributing

This API server is part of the Figma Flow Capture project. For issues, feature requests, or contributions, please refer to the main project repository.

---

*Last updated: May 30, 2025*
