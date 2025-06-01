import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from './logger';

const execAsync = promisify(exec);

export interface DependencyStatus {
  name: string;
  installed: boolean;
  version?: string;
  required: boolean;
  installCommand?: string;
  status: 'installed' | 'missing' | 'checking' | 'installing' | 'error';
  error?: string;
}

export interface SystemInfo {
  platform: string;
  arch: string;
  nodeVersion?: string;
  npmVersion?: string;
  pnpmVersion?: string;
  gitVersion?: string;
  ffmpegVersion?: string;
  brewInstalled?: boolean;
}

export class DependencyManager {
  private static instance: DependencyManager;
  private dependencies: Map<string, DependencyStatus> = new Map();
  private systemInfo: SystemInfo | null = null;

  static getInstance(): DependencyManager {
    if (!DependencyManager.instance) {
      DependencyManager.instance = new DependencyManager();
    }
    return DependencyManager.instance;
  }

  async getSystemInfo(): Promise<SystemInfo> {
    if (this.systemInfo) return this.systemInfo;

    const info: SystemInfo = {
      platform: process.platform,
      arch: process.arch
    };

    try {
      // Check Node.js
      const nodeResult = await execAsync('node --version');
      info.nodeVersion = nodeResult.stdout.trim();
    } catch (error) {
      logger.warn('Node.js not found');
    }

    try {
      // Check npm
      const npmResult = await execAsync('npm --version');
      info.npmVersion = npmResult.stdout.trim();
    } catch (error) {
      logger.warn('npm not found');
    }

    try {
      // Check pnpm
      const pnpmResult = await execAsync('pnpm --version');
      info.pnpmVersion = pnpmResult.stdout.trim();
    } catch (error) {
      logger.warn('pnpm not found');
    }

    try {
      // Check git
      const gitResult = await execAsync('git --version');
      info.gitVersion = gitResult.stdout.trim();
    } catch (error) {
      logger.warn('git not found');
    }

    try {
      // Check FFmpeg
      const ffmpegResult = await execAsync('ffmpeg -version');
      info.ffmpegVersion = ffmpegResult.stdout.split('\n')[0];
    } catch (error) {
      logger.warn('FFmpeg not found');
    }

    try {
      // Check Homebrew (macOS)
      if (process.platform === 'darwin') {
        await execAsync('brew --version');
        info.brewInstalled = true;
      }
    } catch (error) {
      info.brewInstalled = false;
    }

    this.systemInfo = info;
    return info;
  }

  async checkAllDependencies(): Promise<DependencyStatus[]> {
    const systemInfo = await this.getSystemInfo();
    const deps: DependencyStatus[] = [];

    // Homebrew (macOS only, check first as it's needed for other installs)
    if (process.platform === 'darwin') {
      deps.push({
        name: 'Homebrew',
        installed: !!systemInfo.brewInstalled,
        version: systemInfo.brewInstalled ? 'installed' : undefined,
        required: true,
        installCommand: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
        status: systemInfo.brewInstalled ? 'installed' : 'missing'
      });
    }

    // Node.js
    deps.push({
      name: 'Node.js',
      installed: !!systemInfo.nodeVersion,
      version: systemInfo.nodeVersion,
      required: true,
      installCommand: process.platform === 'darwin' ? 'brew install node' : 'Download from nodejs.org',
      status: systemInfo.nodeVersion ? 'installed' : 'missing'
    });

    // pnpm
    deps.push({
      name: 'pnpm',
      installed: !!systemInfo.pnpmVersion,
      version: systemInfo.pnpmVersion,
      required: true,
      installCommand: 'npm install -g pnpm',
      status: systemInfo.pnpmVersion ? 'installed' : 'missing'
    });

    // Git
    deps.push({
      name: 'Git',
      installed: !!systemInfo.gitVersion,
      version: systemInfo.gitVersion,
      required: true,
      installCommand: process.platform === 'darwin' ? 'brew install git' : 'Download from git-scm.com',
      status: systemInfo.gitVersion ? 'installed' : 'missing'
    });

    // FFmpeg
    deps.push({
      name: 'FFmpeg',
      installed: !!systemInfo.ffmpegVersion,
      version: systemInfo.ffmpegVersion,
      required: true,
      installCommand: process.platform === 'darwin' ? 'brew install ffmpeg' : 'Download from ffmpeg.org',
      status: systemInfo.ffmpegVersion ? 'installed' : 'missing'
    });

    // Update internal map
    deps.forEach(dep => {
      this.dependencies.set(dep.name, dep);
    });

    return deps;
  }

  async installDependency(name: string): Promise<{ success: boolean; message: string; output?: string }> {
    const dep = this.dependencies.get(name);
    if (!dep) {
      return { success: false, message: `Dependency ${name} not found` };
    }

    if (dep.installed) {
      return { success: true, message: `${name} is already installed` };
    }

    // Update status to installing
    dep.status = 'installing';
    this.dependencies.set(name, dep);

    try {
      logger.info(`Installing ${name}...`);
      
      let installCommand = '';
      
      switch (name) {
        case 'Homebrew':
          if (process.platform === 'darwin') {
            installCommand = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';
          }
          break;
          
        case 'Node.js':
          if (process.platform === 'darwin') {
            installCommand = 'brew install node';
          }
          break;
          
        case 'pnpm':
          installCommand = 'npm install -g pnpm';
          break;
          
        case 'Git':
          if (process.platform === 'darwin') {
            installCommand = 'brew install git';
          }
          break;
          
        case 'FFmpeg':
          if (process.platform === 'darwin') {
            installCommand = 'brew install ffmpeg';
          }
          break;
          
        default:
          return { success: false, message: `No installation method available for ${name}` };
      }

      if (!installCommand) {
        return { success: false, message: `No installation command available for ${name} on ${process.platform}` };
      }

      const result = await execAsync(installCommand, { 
        timeout: 300000, // 5 minutes timeout
        maxBuffer: 1024 * 1024 // 1MB buffer
      });
      
      // Update status
      dep.status = 'installed';
      dep.installed = true;
      this.dependencies.set(name, dep);
      
      // Refresh system info
      this.systemInfo = null;
      await this.getSystemInfo();
      
      logger.info(`${name} installed successfully`);
      return { 
        success: true, 
        message: `${name} installed successfully`,
        output: result.stdout 
      };
      
    } catch (error: any) {
      logger.error(`Failed to install ${name}:`, error);
      
      // Update status
      dep.status = 'error';
      dep.error = error.message;
      this.dependencies.set(name, dep);
      
      return { 
        success: false, 
        message: `Failed to install ${name}: ${error.message}`,
        output: error.stdout || error.stderr 
      };
    }
  }

  async setupProject(repoUrl: string = 'https://github.com/novincode/figma-flow-capture.git'): Promise<{ success: boolean; message: string; steps: string[] }> {
    const steps: string[] = [];
    
    try {
      // 1. Check if project directory exists
      const homeDir = require('os').homedir();
      const projectDir = path.join(homeDir, 'figma-flow-capture');
      
      steps.push('🔍 Checking project directory...');
      
      try {
        await fs.access(projectDir);
        steps.push('✅ Project directory found');
      } catch {
        steps.push('📁 Cloning project repository...');
        
        // Clone the repository
        const cloneCommand = `git clone ${repoUrl} "${projectDir}"`;
        await execAsync(cloneCommand, { timeout: 120000 }); // 2 minutes timeout
        steps.push('✅ Project cloned successfully');
      }
      
      // 2. Install dependencies
      steps.push('📦 Installing project dependencies...');
      const installCommand = `cd "${projectDir}/figma-flow-capture-v2" && pnpm install`;
      await execAsync(installCommand, { timeout: 300000 }); // 5 minutes timeout
      steps.push('✅ Dependencies installed');
      
      // 3. Install browser dependencies (Playwright)
      steps.push('🌐 Installing browser dependencies...');
      const browserCommand = `cd "${projectDir}/figma-flow-capture-v2" && pnpm playwright install`;
      await execAsync(browserCommand, { timeout: 300000 }); // 5 minutes timeout
      steps.push('✅ Browsers installed');
      
      // 4. Build the project
      steps.push('🔨 Building project...');
      const buildCommand = `cd "${projectDir}/figma-flow-capture-v2" && pnpm build`;
      await execAsync(buildCommand, { timeout: 180000 }); // 3 minutes timeout
      steps.push('✅ Project built successfully');
      
      return {
        success: true,
        message: 'Project setup completed successfully',
        steps
      };
      
    } catch (error: any) {
      steps.push(`❌ Error: ${error.message}`);
      return {
        success: false,
        message: `Project setup failed: ${error.message}`,
        steps
      };
    }
  }

  async startServer(): Promise<{ success: boolean; message: string; pid?: number }> {
    try {
      const homeDir = require('os').homedir();
      const projectDir = path.join(homeDir, 'figma-flow-capture/figma-flow-capture-v2');
      
      // Check if project exists
      try {
        await fs.access(projectDir);
      } catch {
        return {
          success: false,
          message: 'Project not found. Please run setup first.'
        };
      }
      
      // Start the server in the background
      const serverProcess = spawn('pnpm', ['start'], {
        cwd: projectDir,
        detached: true,
        stdio: 'ignore'
      });
      
      serverProcess.unref();
      
      // Wait a bit to see if it starts successfully
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      return {
        success: true,
        message: 'Server started successfully',
        pid: serverProcess.pid
      };
      
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to start server: ${error.message}`
      };
    }
  }

  async installAllMissing(): Promise<{ success: boolean; results: any[]; message: string }> {
    try {
      const dependencies = await this.checkAllDependencies();
      const missing = dependencies.filter(dep => !dep.installed && dep.required);
      
      if (missing.length === 0) {
        return {
          success: true,
          results: [],
          message: 'All dependencies are already installed'
        };
      }

      const results = [];
      
      // Install in order: Homebrew first (if on macOS), then others
      const sortedMissing = missing.sort((a, b) => {
        if (a.name === 'Homebrew') return -1;
        if (b.name === 'Homebrew') return 1;
        return 0;
      });
      
      for (const dep of sortedMissing) {
        const result = await this.installDependency(dep.name);
        results.push({ dependency: dep.name, ...result });
        
        // If this fails and it's a critical dependency, stop
        if (!result.success && dep.required) {
          return {
            success: false,
            results,
            message: `Failed to install ${dep.name}: ${result.message}`
          };
        }
      }
      
      return {
        success: true,
        results,
        message: 'All dependencies installed successfully'
      };
      
    } catch (error: any) {
      return {
        success: false,
        results: [],
        message: `Installation failed: ${error.message}`
      };
    }
  }
}
