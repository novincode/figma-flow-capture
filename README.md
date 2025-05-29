# 🎬 Figma Flow Capture

> **Transform your Figma prototypes into professional video recordings with pixel-perfect precision**

The ultimate tool for capturing smooth, high-quality videos of your Figma prototype interactions. Perfect for presentations, portfolios, social media, and documentation.

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2D8A47?style=flat&logo=playwright&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)

## ✨ What Makes This Special?

**🎯 Zero Configuration Required** - Just paste your Figma URL and start recording  
**📱 Social Media Ready** - Built-in presets for Instagram, TikTok, YouTube Shorts  
**🖥️ Any Resolution** - From mobile to 4K, or create custom dimensions  
**⚡ Two Recording Modes** - Choose between real-time video or frame-by-frame capture  
**🎨 Clean Output** - Automatically hides Figma UI for professional results  
**🔧 Developer Friendly** - Modern TypeScript with full programmatic API  

## 🚀 Quick Start

```bash
# Install dependencies
pnpm install

# Install browsers (one-time setup)
pnpm run install-browsers

# Start recording! 🎬
pnpm run record
```

That's it! The interactive CLI will guide you through the rest.

## 🎥 Recording Modes

### 📹 Video Recording (Recommended)
Real-time browser video capture using MediaRecorder API
- **Perfect for**: Live demonstrations, smooth animations
- **Output**: High-quality `.webm` video files
- **Performance**: Fast and efficient

### 🖼️ Frame-by-Frame Capture
Canvas-based frame capture with precise timing control
- **Perfect for**: High-fidelity recordings, complex animations
- **Output**: Individual frames assembled into video via FFmpeg
- **Requirement**: FFmpeg must be installed

## 📐 Resolution Presets

### 📱 Social Media Optimized
- **Instagram Story/Reel**: 1080×1920 (9:16)
- **TikTok**: 1080×1920 (9:16)  
- **YouTube Shorts**: 1080×1920 (9:16)
- **Square**: 1080×1080 (1:1)

### 🖥️ Professional Quality
- **4K Desktop**: 3840×2160 (16:9)
- **Full HD**: 1920×1080 (16:9)
- **HD**: 1280×720 (16:9)
- **Standard**: 854×480 (16:9)

### 📱 Device Specific
- **iPhone**: 375×812 (Mobile Portrait)
- **iPad Portrait**: 768×1024 (4:3)
- **iPad Landscape**: 1024×768 (4:3)
- **Auto**: Uses your Figma canvas dimensions

### 🎨 Custom Dimensions
Enter any resolution you need - perfect for specific requirements or unique aspect ratios.

## 💻 Usage

### 🎯 Interactive Mode (Easiest)
```bash
pnpm run record
```
Follow the guided prompts to configure your recording.

### ⚙️ Programmatic Usage
```typescript
import { FigmaRecorder } from './src/core/recorder.js';

const recorder = new FigmaRecorder();

await recorder.record({
  url: 'https://www.figma.com/proto/your-prototype-url',
  duration: 30000, // 30 seconds
  recordingMode: 'video',
  quality: 'instagram-story', // or 'custom'
  customWidth: 1080,         // if quality is 'custom'
  customHeight: 1920,        // if quality is 'custom'
  outputDir: './recordings'
});
```

### 🎬 Advanced Configuration

```typescript
const options = {
  url: 'https://www.figma.com/proto/ABC123',
  duration: 45000,
  recordingMode: 'frames',  // 'video' or 'frames'
  quality: 'custom',
  customWidth: 1080,
  customHeight: 1080,
  outputDir: './my-recordings',
  scaleToFit: true  // Scale canvas to fit exact dimensions
};

await recorder.record(options);
```

## 📁 Output Structure

Your recordings are automatically organized with timestamps:

```
recordings/
├── figma-recording-2025-01-15T14-30-22-123Z.webm
├── figma-recording-2025-01-15T14-35-18-456Z.webm
└── frames/  # Only for frame-by-frame mode
    ├── frame-001.png
    ├── frame-002.png
    └── ...
```

## 🛠️ Project Architecture

```
src/
├── core/
│   └── recorder.ts           # Main FigmaRecorder class
├── types/
│   └── recording.ts          # TypeScript interfaces
├── utils/
│   ├── video-capture.ts      # MediaRecorder implementation
│   ├── frame-capture.ts      # Canvas frame capture
│   ├── resolution-presets.ts # Built-in resolution configs
│   ├── ffmpeg-checker.ts     # FFmpeg availability check
│   ├── logger.ts             # Colored console output
│   └── file-utils.ts         # File system utilities
└── index.ts                  # Interactive CLI interface
```

## 🎯 Use Cases

### 👨‍💼 **For Product Teams**
- Create smooth demo videos for stakeholder presentations
- Document user flows for development handoffs
- Generate marketing assets from interactive prototypes

### 🎨 **For Designers** 
- Build portfolio pieces with professional video quality
- Share design concepts on social media platforms
- Create tutorials showing interaction patterns

### 🏢 **For Agencies**
- Present client work with polished video deliverables
- Create case study materials for websites
- Generate content for social media marketing

### 📚 **For Educators**
- Record design process demonstrations
- Create instructional content for courses
- Document best practices in UX/UI design

## ⚡ Performance & Quality

### Video Recording Mode
- **Quality**: High-fidelity MediaRecorder output
- **Performance**: Real-time capture, minimal CPU usage
- **File Size**: Optimized WebM encoding
- **Compatibility**: Works on all modern browsers

### Frame-by-Frame Mode  
- **Quality**: Pixel-perfect canvas capture
- **Performance**: Higher CPU usage during recording
- **File Size**: Larger intermediate files, compressed final output
- **Precision**: Exact timing control for complex animations

## 🔧 Requirements

- **Node.js**: 18.0.0 or higher
- **Package Manager**: pnpm, npm, or yarn
- **Browsers**: Auto-installed via Playwright
- **FFmpeg**: Optional (required only for frame-by-frame mode)

### Installing FFmpeg

**macOS (Homebrew):**
```bash
brew install ffmpeg
```

**Windows (Chocolatey):**
```bash
choco install ffmpeg
```

**Ubuntu/Debian:**
```bash
sudo apt update && sudo apt install ffmpeg
```

## 🚀 Development

### Building the Project
```bash
pnpm run build
```

### Development Mode
```bash
pnpm run dev
```

### Available Scripts
- `pnpm run record` - Start interactive recording session
- `pnpm run build` - Compile TypeScript to JavaScript  
- `pnpm run dev` - Run directly with tsx (development)
- `pnpm run start` - Run compiled JavaScript
- `pnpm run install-browsers` - Install Playwright browser binaries

## 🎨 Tips for Best Results

### 🎯 **Preparation**
- Ensure your Figma prototype has clear interaction flows
- Test your prototype manually before recording
- Close unnecessary browser tabs to free up resources

### 📱 **For Social Media**
- Use vertical presets (1080×1920) for Instagram/TikTok
- Consider adding captions or overlays post-production
- Keep recordings under 60 seconds for maximum engagement

### 🖥️ **For Presentations**
- Use high-quality presets (1920×1080 or 4K)
- Record slightly longer than needed for editing flexibility
- Consider the viewing context (projector, laptop, mobile)

### 🎬 **Technical Optimization**
- Video mode for smooth, real-time interactions
- Frame mode for pixel-perfect quality or complex animations
- Custom resolutions for specific platform requirements

## 🤝 Contributing

We welcome contributions! Feel free to:

- 🐛 Report bugs via GitHub Issues
- 💡 Suggest new features or improvements  
- 🔧 Submit pull requests with enhancements
- 📖 Improve documentation

## 📄 License

This project is licensed under the **ISC License**.

---

<div align="center">

**Ready to create amazing Figma recordings?**

```bash
pnpm run record
```

*Star ⭐ this repo if it helped you create awesome prototype videos!*

</div>
