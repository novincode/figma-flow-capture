# Figma Flow Capture v2

A modern TypeScript tool for capturing Figma prototype flows using Playwright.

## Features

- 🎬 **High-quality video recording** of Figma prototypes
- 🎯 **Interactive CLI** with prompts for easy configuration  
- ⚡ **Modern TypeScript** with ES2022 and ESM support
- 🎨 **Multiple quality presets** (High/Medium/Low)
- 📁 **Organized output** with timestamped recordings
- 🛠 **Extensible architecture** for future enhancements

## Quick Start

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Install Playwright browsers:**
   ```bash
   pnpm run install-browsers
   ```

3. **Start recording:**
   ```bash
   pnpm run record
   ```

## Usage

### Interactive Mode
Run the CLI and follow the prompts:
```bash
pnpm run record
```

### Programmatic Usage
```typescript
import { recordFigmaFlow } from './src/core/recorder.js';

const result = await recordFigmaFlow({
  url: 'https://www.figma.com/proto/your-prototype-url',
  duration: 15000, // 15 seconds
  viewport: { width: 1920, height: 1080 },
  outputDir: './recordings'
});

if (result.success) {
  console.log(`Recording saved to: ${result.outputPath}`);
}
```

## Configuration

### Recording Options
- **URL**: Figma prototype URL
- **Duration**: Recording length in milliseconds
- **Viewport**: Video dimensions (width x height)
- **Output Directory**: Where to save recordings
- **Quality**: Preset quality levels

### Quality Presets
- **High**: 1920x1080 (Full HD)
- **Medium**: 1280x720 (HD)
- **Low**: 854x480 (SD)

## Project Structure

```
src/
├── core/
│   └── recorder.ts     # Main recording logic
├── types/
│   └── recording.ts    # TypeScript interfaces
├── utils/
│   ├── logger.ts       # Colored logging utility
│   └── file-utils.ts   # File system helpers
└── index.ts           # CLI entry point
```

## Development

### Build
```bash
pnpm run build
```

### Development Mode
```bash
pnpm run dev
```

## Output

Recordings are saved to `./recordings/` by default with timestamped filenames:
```
recordings/
└── figma-recording-2025-05-29T10-30-45-123Z.webm
```

## Requirements

- Node.js 18+
- pnpm (or npm/yarn)
- Playwright browsers (auto-installed)

## License

ISC
