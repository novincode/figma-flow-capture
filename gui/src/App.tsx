import { useState, useEffect } from 'react';
import { SetupWizard } from './components/SetupWizard';
import { RecordingConfig } from './components/RecordingConfig';
import { RecordingStatus } from './components/RecordingStatus';
import { tauriAPI } from './lib/tauri';
import { DependencyStatus, RecordingOptions, RecordingSession } from './types';

type AppState = 'checking' | 'setup' | 'ready' | 'recording';

function App() {
  const [appState, setAppState] = useState<AppState>('checking');
  const [dependencies, setDependencies] = useState<DependencyStatus>({
    nodejs: { installed: false, version: null },
    pnpm: { installed: false, version: null },
    ffmpeg: { installed: false, version: null },
    browsers: { installed: false, version: null }
  });
  const [currentRecording, setCurrentRecording] = useState<RecordingSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkingProgress, setCheckingProgress] = useState<string>('Initializing...');

  // Set dark mode
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  useEffect(() => {
    checkDependencies();
  }, []);

  const checkDependencies = async () => {
    try {
      setError(null);
      setCheckingProgress('Checking system dependencies...');
      
      // Add a small delay to ensure the UI updates
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Set a timeout for the dependency check
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Dependency check timed out')), 15000)
      );
      
      const dependencyPromise = tauriAPI.checkDependencies();
      
      const status = await Promise.race([dependencyPromise, timeoutPromise]) as DependencyStatus;
      setDependencies(status);
      
      setCheckingProgress('Finalizing...');
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const allInstalled = Object.values(status).every(dep => dep.installed);
      if (allInstalled) {
        setAppState('ready');
      } else {
        setAppState('setup');
      }
    } catch (err) {
      console.error('Dependency check error:', err);
      setError(`Failed to check dependencies: ${err}`);
      setAppState('setup');
    }
  };

  const handleSetupComplete = () => {
    setAppState('ready');
    checkDependencies();
  };

  const handleStartRecording = async (options: RecordingOptions) => {
    try {
      setError(null);
      const session = await tauriAPI.startRecording(options);
      setCurrentRecording(session);
      setAppState('recording');
    } catch (err) {
      setError(`Failed to start recording: ${err}`);
    }
  };

  const handleStopRecording = async () => {
    if (!currentRecording) return;
    
    try {
      setError(null);
      await tauriAPI.stopRecording(currentRecording.id);
      setCurrentRecording(null);
      setAppState('ready');
    } catch (err) {
      setError(`Failed to stop recording: ${err}`);
    }
  };

  const renderContent = () => {
    switch (appState) {
      case 'checking':
        return (
          <div className="flex items-center justify-center min-h-screen">
            <div className="text-center">
              <div className="spinner h-16 w-16 mx-auto mb-6"></div>
              <p className="text-white text-xl font-medium mb-2">{checkingProgress}</p>
              <p className="text-dark-400 text-sm">This should only take a moment...</p>
            </div>
          </div>
        );

      case 'setup':
        return (
          <SetupWizard
            dependencies={dependencies}
            onComplete={handleSetupComplete}
            onError={setError}
          />
        );

      case 'ready':
        return (
          <div className="max-w-5xl mx-auto p-8 animate-fade-in">
            <div className="text-center mb-12">
              <h1 className="heading-primary mb-6">
                Figma Flow Capture
              </h1>
              <div className="flex items-center justify-center mb-4">
                <div className="h-1 w-16 bg-primary-500 rounded-full mr-3"></div>
                <p className="text-dark-200 text-xl font-light">
                  Record beautiful animated demos of your Figma prototypes
                </p>
                <div className="h-1 w-16 bg-primary-500 rounded-full ml-3"></div>
              </div>
            </div>
            <RecordingConfig 
              onStartRecording={handleStartRecording} 
              isRecording={false}
            />
          </div>
        );

      case 'recording':
        return (
          <RecordingStatus
            isRecording={true}
            result={null}
            onStopRecording={handleStopRecording}
            onOpenFolder={() => console.log('Open folder')}
            onNewRecording={() => setAppState('ready')}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen dark bg-gradient-dark relative overflow-hidden">
      {/* Animated background glows */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-primary-900/20 rounded-full blur-3xl animate-pulse-glow"></div>
      <div className="absolute top-1/2 -right-60 w-96 h-96 bg-primary-900/10 rounded-full blur-3xl animate-pulse-glow" style={{animationDelay: '1s'}}></div>
      <div className="absolute -bottom-40 left-1/3 w-80 h-80 bg-primary-900/15 rounded-full blur-3xl animate-pulse-glow" style={{animationDelay: '2s'}}></div>
      
      {/* Grid background */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGZpbGw9IiMxZTI5M2IiIGZpbGwtb3BhY2l0eT0iMC4wNCIgZD0iTTMwIDMwaDMwdjMwaC0zMHoiLz48cGF0aCBmaWxsPSIjMWUyOTNiIiBmaWxsLW9wYWNpdHk9IjAuMDQiIGQ9Ik0wIDBoMzB2MzBoLTMweiIvPjwvZz48L3N2Zz4=')] opacity-25"></div>
      
      {/* Main content with z-index */}
      <div className="relative z-10 min-h-screen">
        {/* Error message */}
        {error && (
          <div className="fixed top-5 right-5 z-50 glass-card text-white px-6 py-4 rounded-2xl shadow-dark-lg flex items-center space-x-3 border-l-4 border-error-600 animate-slide-down">
            <div className="text-error-500">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <span className="font-medium">{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-4 hover:bg-dark-700/50 p-1.5 rounded-lg transition-colors"
              aria-label="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        
        {renderContent()}
      </div>
    </div>
  );
}

export default App;