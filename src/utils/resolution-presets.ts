export interface ResolutionPreset {
  name: string;
  width: number;
  height: number;
  description: string;
}

export const RESOLUTION_PRESETS: Record<string, ResolutionPreset> = {
  'low': {
    name: 'Low Quality',
    width: 854,
    height: 480,
    description: 'SD (854×480)'
  },
  'medium': {
    name: 'Medium Quality', 
    width: 1280,
    height: 720,
    description: 'HD (1280×720)'
  },
  'high': {
    name: 'High Quality',
    width: 1920,
    height: 1080,
    description: 'Full HD (1920×1080)'
  },
  'instagram-story': {
    name: 'Instagram Story',
    width: 1080,
    height: 1920,
    description: 'Instagram Story (1080×1920)'
  },
  'instagram-reel': {
    name: 'Instagram Reel',
    width: 1080,
    height: 1920,
    description: 'Instagram Reel (1080×1920)'
  },
  'tiktok': {
    name: 'TikTok',
    width: 1080,
    height: 1920,
    description: 'TikTok (1080×1920)'
  },
  'youtube-shorts': {
    name: 'YouTube Shorts',
    width: 1080,
    height: 1920,
    description: 'YouTube Shorts (1080×1920)'
  },
  'desktop-4k': {
    name: 'Desktop 4K',
    width: 3840,
    height: 2160,
    description: '4K (3840×2160)'
  },
  'mobile-portrait': {
    name: 'Mobile Portrait',
    width: 375,
    height: 812,
    description: 'iPhone 12/13 (375×812)'
  },
  'tablet-portrait': {
    name: 'Tablet Portrait',
    width: 768,
    height: 1024,
    description: 'iPad (768×1024)'
  },
  'tablet-landscape': {
    name: 'Tablet Landscape',
    width: 1024,
    height: 768,
    description: 'iPad Landscape (1024×768)'
  }
};

export function getResolutionChoices() {
  const presets = Object.entries(RESOLUTION_PRESETS).map(([key, preset]) => ({
    title: `${preset.name} - ${preset.description}`,
    value: key
  }));
  
  return [
    ...presets,
    {
      title: 'Custom Resolution - Enter your own dimensions',
      value: 'custom'
    }
  ];
}

export function getResolution(quality: string, customWidth?: number, customHeight?: number) {
  if (quality === 'custom' && customWidth && customHeight) {
    return { width: customWidth, height: customHeight };
  }
  
  const preset = RESOLUTION_PRESETS[quality];
  if (!preset) {
    // Fallback to high quality
    return RESOLUTION_PRESETS.high;
  }
  
  return { width: preset.width, height: preset.height };
}
