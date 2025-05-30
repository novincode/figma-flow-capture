import React from 'react';
import { CheckCircle, XCircle, Download, ExternalLink } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { SystemDependency } from '../types';

interface DependencyCardProps {
  dependency: SystemDependency;
  onInstall?: () => void;
  isInstalling?: boolean;
}

export const DependencyCard: React.FC<DependencyCardProps> = ({ 
  dependency, 
  onInstall,
  isInstalling = false 
}) => {
  const getStatusIcon = () => {
    if (dependency.installed) {
      return (
        <div className="w-10 h-10 bg-success-500/20 rounded-full flex items-center justify-center">
          <CheckCircle className="w-5 h-5 text-success-500" />
        </div>
      );
    } else {
      return (
        <div className="w-10 h-10 bg-error-500/20 rounded-full flex items-center justify-center">
          <XCircle className="w-5 h-5 text-error-500" />
        </div>
      );
    }
  };

  const getStatusText = () => {
    if (dependency.installed) {
      return dependency.version ? `Installed (${dependency.version})` : 'Installed';
    } else {
      return 'Not installed';
    }
  };

  return (
    <div className="card bg-dark-900/40 backdrop-blur-xl border border-dark-800/50 hover:border-dark-700/50 transition-all duration-300">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          {getStatusIcon()}
          <div>
            <h3 className="font-semibold text-white text-lg mb-1">{dependency.name}</h3>
            <p className={`text-sm ${dependency.installed ? 'text-success-400' : 'text-dark-400'}`}>
              {getStatusText()}
            </p>
          </div>
        </div>
        
        {!dependency.installed && (
          <div className="flex space-x-3">
            {dependency.install_command && onInstall && (
              <button
                onClick={onInstall}
                disabled={isInstalling}
                className="btn-primary flex items-center space-x-2 py-2 px-4"
              >
                <Download className="w-4 h-4" />
                <span>{isInstalling ? 'Installing...' : 'Install'}</span>
              </button>
            )}
            {dependency.install_url && (
              <button
                onClick={() => openUrl(dependency.install_url!)}
                className="btn-secondary flex items-center space-x-2 py-2 px-4"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Download</span>
              </button>
            )}
          </div>
        )}
      </div>
      
      {!dependency.installed && dependency.install_command && (
        <div className="mt-4 p-4 bg-dark-800/60 border border-dark-700/30 rounded-xl">
          <p className="text-sm text-primary-300 font-mono">
            $ {dependency.install_command}
          </p>
        </div>
      )}
    </div>
  );
};
