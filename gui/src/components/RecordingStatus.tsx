import React from 'react';
import { CheckCircle, XCircle, Clock, FileVideo, Folder } from 'lucide-react';
import { RecordingResult } from '../types';

interface RecordingStatusProps {
  isRecording: boolean;
  result: RecordingResult | null;
  onStopRecording?: () => void;
  onOpenFolder: () => void;
  onNewRecording: () => void;
}

export const RecordingStatus: React.FC<RecordingStatusProps> = ({
  isRecording,
  result,
  onStopRecording,
  onOpenFolder,
  onNewRecording
}) => {
  if (isRecording) {
    return (
      <div className="card">
        <div className="text-center">
          <div className="animate-pulse-slow">
            <div className="w-16 h-16 bg-error-500 rounded-full mx-auto mb-4 flex items-center justify-center shadow-glow">
              <div className="w-6 h-6 bg-white rounded-full"></div>
            </div>
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">Recording in Progress</h3>
          <p className="text-dark-300 mb-4">
            Please interact with your Figma prototype. The recording will capture your actions.
          </p>
          <div className="flex items-center justify-center space-x-2 text-sm text-primary-400 mb-6">
            <Clock className="w-4 h-4" />
            <span>Recording active...</span>
          </div>
          {onStopRecording && (
            <button
              onClick={onStopRecording}
              className="btn-danger flex items-center justify-center space-x-2 mx-auto"
            >
              <XCircle className="w-4 h-4" />
              <span>Stop Recording</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="card">
        <div className="text-center">
          {result.success ? (
            <>
              <CheckCircle className="w-16 h-16 text-success-400 mx-auto mb-4 shadow-glow" />
              <h3 className="text-lg font-semibold text-white mb-2">Recording Completed!</h3>
              <p className="text-dark-300 mb-4">
                Your Figma prototype recording has been saved successfully.
              </p>
              
              {result.output_path && (
                <div className="bg-success-900/30 border border-success-700/20 rounded-xl p-4 mb-4">
                  <div className="flex items-center space-x-2 text-sm text-success-400">
                    <FileVideo className="w-4 h-4" />
                    <span className="font-mono break-all">{result.output_path}</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 text-sm text-dark-300 mb-6">
                {result.duration && (
                  <div>
                    <span className="font-medium text-dark-200">Duration:</span> <span className="text-primary-300">{result.duration.toFixed(1)}s</span>
                  </div>
                )}
                {result.frame_count && (
                  <div>
                    <span className="font-medium text-dark-200">Frames:</span> <span className="text-primary-300">{result.frame_count}</span>
                  </div>
                )}
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={onOpenFolder}
                  className="btn-secondary flex items-center space-x-2"
                >
                  <Folder className="w-4 h-4" />
                  <span>Open Folder</span>
                </button>
                <button
                  onClick={onNewRecording}
                  className="btn-primary flex items-center space-x-2"
                >
                  <FileVideo className="w-4 h-4" />
                  <span>New Recording</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <XCircle className="w-16 h-16 text-error-500 mx-auto mb-4 shadow-glow" />
              <h3 className="text-lg font-semibold text-white mb-2">Recording Failed</h3>
              <p className="text-dark-300 mb-4">
                There was an error during the recording process.
              </p>
              
              {result.error && (
                <div className="bg-error-900/30 border border-error-700/20 rounded-xl p-4 mb-4">
                  <div className="text-sm text-error-400 font-mono break-all">
                    {result.error}
                  </div>
                </div>
              )}

              <button
                onClick={onNewRecording}
                className="btn-primary flex items-center space-x-2"
              >
                <FileVideo className="w-4 h-4" />
                <span>Try Again</span>
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return null;
};
