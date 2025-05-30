import React, { useState } from 'react';
import { Play, Settings, Video, Camera, Clock, Monitor } from 'lucide-react';
import { RecordingOptions, RESOLUTION_PRESETS } from '../types';

interface RecordingConfigProps {
  onStartRecording: (options: RecordingOptions) => void;
  isRecording: boolean;
}

export const RecordingConfig: React.FC<RecordingConfigProps> = ({
  onStartRecording,
  isRecording
}) => {
  const [options, setOptions] = useState<RecordingOptions>({
    figma_url: '',
    recording_mode: 'video',
    quality: 'high-quality',
    duration: 30,
    format: 'mp4',
    frame_rate: 30,
    wait_for_canvas: true
  });

  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (options.figma_url.trim()) {
      onStartRecording(options);
    }
  };

  const selectedPreset = RESOLUTION_PRESETS[options.quality];

  return (
    <div className="card">
      <div className="flex items-center space-x-3 mb-6">
        <Video className="w-6 h-6 text-primary-400" />
        <h2 className="text-xl font-bold text-white">Recording Configuration</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Figma URL */}
        <div>
          <label className="block text-sm font-medium text-dark-200 mb-2">
            Figma Prototype URL
          </label>
          <input
            type="url"
            value={options.figma_url}
            onChange={(e) => setOptions(prev => ({ ...prev, figma_url: e.target.value }))}
            placeholder="https://www.figma.com/proto/..."
            className="input w-full"
            required
          />
        </div>

        {/* Recording Mode */}
        <div>
          <label className="block text-sm font-medium text-dark-200 mb-2">
            Recording Mode
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setOptions(prev => ({ ...prev, recording_mode: 'video' }))}
              className={`p-4 border-2 rounded-lg transition-all ${
                options.recording_mode === 'video'
                  ? 'border-primary-500 bg-dark-800/60 shadow-glow'
                  : 'border-dark-700 hover:border-dark-600 bg-dark-900/60'
              }`}
            >
              <Video className="w-6 h-6 mx-auto mb-2 text-primary-400" />
              <div className="text-sm font-medium text-white">Video Mode</div>
              <div className="text-xs text-dark-400">Real-time recording</div>
            </button>
            <button
              type="button"
              onClick={() => setOptions(prev => ({ ...prev, recording_mode: 'frames' }))}
              className={`p-4 border-2 rounded-lg transition-all ${
                options.recording_mode === 'frames'
                  ? 'border-primary-500 bg-dark-800/60 shadow-glow'
                  : 'border-dark-700 hover:border-dark-600 bg-dark-900/60'
              }`}
            >
              <Camera className="w-6 h-6 mx-auto mb-2 text-primary-400" />
              <div className="text-sm font-medium text-white">Frame Mode</div>
              <div className="text-xs text-dark-400">High-quality capture</div>
            </button>
          </div>
        </div>

        {/* Quality Preset */}
        <div>
          <label className="block text-sm font-medium text-dark-200 mb-2">
            Quality Preset
          </label>
          <select
            value={options.quality}
            onChange={(e) => setOptions(prev => ({ ...prev, quality: e.target.value }))}
            className="input w-full appearance-none bg-dark-800/60 text-white"
          >
            {Object.entries(RESOLUTION_PRESETS).map(([key, preset]) => (
              <option key={key} value={key} className="bg-dark-800 text-white">
                {preset.name} ({preset.width}×{preset.height}) - {preset.description}
              </option>
            ))}
          </select>
        </div>

        {/* Custom Resolution */}
        {options.quality === 'custom' && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-dark-200 mb-2">
                Width
              </label>
              <input
                type="number"
                value={options.custom_width || 1920}
                onChange={(e) => setOptions(prev => ({ ...prev, custom_width: parseInt(e.target.value) }))}
                className="input w-full"
                min="100"
                max="7680"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-dark-200 mb-2">
                Height
              </label>
              <input
                type="number"
                value={options.custom_height || 1080}
                onChange={(e) => setOptions(prev => ({ ...prev, custom_height: parseInt(e.target.value) }))}
                className="input w-full"
                min="100"
                max="4320"
              />
            </div>
          </div>
        )}

        {/* Duration */}
        <div>
          <label className="block text-sm font-medium text-dark-200 mb-2">
            Duration (seconds)
          </label>
          <div className="flex items-center space-x-3">
            <Clock className="w-5 h-5 text-primary-400" />
            <input
              type="number"
              value={options.duration || 30}
              onChange={(e) => setOptions(prev => ({ ...prev, duration: parseInt(e.target.value) }))}
              className="input flex-1"
              min="5"
              max="300"
            />
          </div>
        </div>

        {/* Advanced Options */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center space-x-2 text-primary-400 hover:text-primary-300 transition-colors"
          >
            <Settings className="w-4 h-4" />
            <span className="text-sm font-medium">
              {showAdvanced ? 'Hide' : 'Show'} Advanced Options
            </span>
          </button>
          
          {showAdvanced && (
            <div className="mt-4 space-y-4 p-4 bg-dark-800/60 border border-dark-700/50 rounded-xl backdrop-blur-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-dark-200 mb-2">
                    Output Format
                  </label>
                  <select
                    value={options.format}
                    onChange={(e) => setOptions(prev => ({ ...prev, format: e.target.value }))}
                    className="input w-full"
                  >
                    <option value="mp4" className="bg-dark-800 text-white">MP4 (Best compatibility)</option>
                    <option value="webm" className="bg-dark-800 text-white">WebM (Smaller file size)</option>
                  </select>
                </div>
                
                {options.recording_mode === 'frames' && (
                  <div>
                    <label className="block text-sm font-medium text-dark-200 mb-2">
                      Frame Rate
                    </label>
                    <select
                      value={options.frame_rate}
                      onChange={(e) => setOptions(prev => ({ ...prev, frame_rate: parseInt(e.target.value) }))}
                      className="input w-full"
                    >
                      <option value={10} className="bg-dark-800 text-white">10 FPS</option>
                      <option value={15} className="bg-dark-800 text-white">15 FPS</option>
                      <option value={24} className="bg-dark-800 text-white">24 FPS</option>
                      <option value={30} className="bg-dark-800 text-white">30 FPS</option>
                      <option value={60} className="bg-dark-800 text-white">60 FPS</option>
                    </select>
                  </div>
                )}
              </div>
              
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="wait_for_canvas"
                  checked={options.wait_for_canvas}
                  onChange={(e) => setOptions(prev => ({ ...prev, wait_for_canvas: e.target.checked }))}
                  className="h-4 w-4 bg-dark-700 text-primary-500 focus:ring-primary-500 focus:ring-offset-dark-800 border-dark-600 rounded"
                />
                <label htmlFor="wait_for_canvas" className="ml-2 block text-sm text-dark-300">
                  Wait for Figma canvas to be ready before recording
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Recording Preview */}
        <div className="p-4 bg-dark-800/80 rounded-xl border border-primary-900/30 ">
          <div className="flex items-center space-x-2 mb-2">
            <Monitor className="w-5 h-5 text-primary-400" />
            <span className="font-medium text-white">Recording Preview</span>
          </div>
          <div className="text-sm text-dark-300 space-y-1">
            <p>Mode: <span className="text-primary-300">{options.recording_mode === 'video' ? 'Real-time Video' : 'Frame-by-Frame'}</span></p>
            <p>Resolution: <span className="text-primary-300">{selectedPreset.width}×{selectedPreset.height}</span></p>
            <p>Duration: <span className="text-primary-300">{options.duration}s</span></p>
            <p>Format: <span className="text-primary-300">{options.format.toUpperCase()}</span></p>
            {options.recording_mode === 'frames' && (
              <p>Frame Rate: <span className="text-primary-300">{options.frame_rate} FPS</span></p>
            )}
          </div>
        </div>

        {/* Start Recording Button */}
        <button
          type="submit"
          disabled={isRecording || !options.figma_url.trim()}
          className="w-full btn-primary flex items-center justify-center space-x-2 py-3"
        >
          <Play className="w-5 h-5" />
          <span>{isRecording ? 'Recording in Progress...' : 'Start Recording'}</span>
        </button>
      </form>
    </div>
  );
};
