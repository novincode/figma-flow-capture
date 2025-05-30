import React, { useState, useEffect } from 'react';
import { CheckCircle, AlertTriangle, RefreshCw, Download, Clapperboard } from 'lucide-react';
import { DependencyCard } from '../components/DependencyCard';
import { InstallationStatus, DependencyStatus } from '../types';
import { TauriAPI } from '../lib/tauri';

interface SetupWizardProps {
  dependencies: DependencyStatus;
  onComplete: () => void;
  onError: (error: string) => void;
}

export const SetupWizard: React.FC<SetupWizardProps> = ({ dependencies, onComplete, onError }) => {
  const [status, setStatus] = useState<InstallationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);

  const checkDependencies = async () => {
    setLoading(true);
    try {
      const result = await TauriAPI.checkSystemDependencies();
      setStatus(result);
    } catch (error) {
      console.error('Failed to check dependencies:', error);
      onError(`Failed to check dependencies: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkDependencies();
  }, []);

  const handleInstallDependencies = async () => {
    setInstalling('dependencies');
    try {
      await TauriAPI.installDependencies();
      await checkDependencies();
    } catch (error) {
      console.error('Failed to install dependencies:', error);
      onError(`Failed to install dependencies: ${error}`);
    } finally {
      setInstalling(null);
    }
  };

  const handleInstallBrowsers = async () => {
    setInstalling('browsers');
    try {
      await TauriAPI.installPlaywrightBrowsers();
      await checkDependencies();
    } catch (error) {
      console.error('Failed to install browsers:', error);
      onError(`Failed to install browsers: ${error}`);
    } finally {
      setInstalling(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center animate-fade-in">
          <div className="spinner w-16 h-16 mx-auto mb-6"></div>
          <p className="text-white text-xl font-medium">Checking system dependencies...</p>
        </div>
      </div>
    );
  }

  const allDepsInstalled = Object.values(dependencies).every(dep => dep.installed);

  if (allDepsInstalled) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="max-w-md text-center glass-card p-10 animate-fade-in">
          <div className="w-24 h-24 mx-auto mb-8 rounded-full bg-dark-800/70 flex items-center justify-center">
            <CheckCircle className="w-12 h-12 text-success-500" />
          </div>
          <h2 className="text-3xl font-bold mb-4 text-white">Setup Complete!</h2>
          <p className="text-dark-300 text-lg mb-8">
            All dependencies are installed and ready. You can now start recording Figma prototypes.
          </p>
          <button
            onClick={onComplete}
            className="btn-primary px-10 py-4 text-lg w-full"
          >
            Start Recording
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-6 py-12 animate-fade-in">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-dark-800/70 flex items-center justify-center shadow-glow">
            <Clapperboard className="w-12 h-12 text-primary-400" />
          </div>
          <h1 className="heading-primary mb-6">
            Setup Figma Flow Capture
          </h1>
          <div className="flex items-center justify-center mb-4">
            <div className="h-1 w-16 bg-primary-600/30 rounded-full mr-3"></div>
            <p className="text-dark-300 text-xl font-light">
              Let's install the required dependencies to get started
            </p>
            <div className="h-1 w-16 bg-primary-600/30 rounded-full ml-3"></div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
          <DependencyCard
            dependency={{
              name: "Node.js",
              installed: dependencies.nodejs.installed,
              version: dependencies.nodejs.version || undefined,
              install_url: "https://nodejs.org/"
            }}
            onInstall={() => window.open('https://nodejs.org/', '_blank')}
            isInstalling={installing === 'nodejs'}
          />

          <DependencyCard
            dependency={{
              name: "pnpm",
              installed: dependencies.pnpm.installed,
              version: dependencies.pnpm.version || undefined
            }}
            onInstall={handleInstallDependencies}
            isInstalling={installing === 'pnpm'}
          />

          <DependencyCard
            dependency={{
              name: "FFmpeg",
              installed: dependencies.ffmpeg.installed,
              version: dependencies.ffmpeg.version || undefined,
              install_url: "https://ffmpeg.org/download.html"
            }}
            onInstall={() => window.open('https://ffmpeg.org/download.html', '_blank')}
            isInstalling={installing === 'ffmpeg'}
          />

          <DependencyCard
            dependency={{
              name: "Playwright Browsers",
              installed: dependencies.browsers.installed,
              version: dependencies.browsers.version || undefined
            }}
            onInstall={handleInstallBrowsers}
            isInstalling={installing === 'browsers'}
          />
        </div>

        <div className="flex justify-center space-x-6">
          <button
            onClick={checkDependencies}
            disabled={installing !== null}
            className="btn-secondary flex items-center"
          >
            <RefreshCw className={`w-5 h-5 mr-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh Status
          </button>

          <button
            onClick={handleInstallDependencies}
            disabled={installing !== null || dependencies.nodejs.installed}
            className="btn-primary flex items-center"
          >
            <Download className="w-5 h-5 mr-3" />
            {installing === 'dependencies' ? 'Installing...' : 'Install Dependencies'}
          </button>
        </div>

        {status && !status.ready_to_record && (
          <div className="mt-10 glass-card p-5 border-l-4 border-warning-500">
            <div className="flex items-start">
              <AlertTriangle className="w-6 h-6 text-warning-400 mt-0.5 mr-3 flex-shrink-0" />
              <div>
                <h3 className="font-medium text-white mb-2">Manual Installation Required</h3>
                <p className="text-dark-300">
                  Some dependencies require manual installation. Please follow the installation links above.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
