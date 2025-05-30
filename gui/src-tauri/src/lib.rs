use serde::{Deserialize, Serialize};
use std::process::Command;
use std::path::PathBuf;
use std::env;
use uuid::Uuid;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

// Global storage for active recording sessions
static ACTIVE_RECORDINGS: LazyLock<Mutex<HashMap<String, std::process::Child>>> = LazyLock::new(|| {
    Mutex::new(HashMap::new())
});

#[derive(Debug, Serialize, Deserialize)]
pub struct SystemDependency {
    name: String,
    installed: bool,
    version: Option<String>,
    install_command: Option<String>,
    install_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecordingOptions {
    figma_url: String,
    recording_mode: String, // "video" or "frames"
    quality: String,
    custom_width: Option<u32>,
    custom_height: Option<u32>,
    duration: Option<u32>,
    format: String,
    frame_rate: Option<u32>,
    wait_for_canvas: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecordingSession {
    id: String,
    status: String, // 'preparing' | 'recording' | 'processing' | 'completed' | 'failed'
    start_time: String,
    duration: Option<f64>,
    output_path: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecordingResult {
    success: bool,
    output_path: Option<String>,
    duration: Option<f64>,
    frame_count: Option<u32>,
    error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InstallationStatus {
    dependencies: Vec<SystemDependency>,
    ready_to_record: bool,
    project_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DependencyInfo {
    installed: bool,
    version: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DependencyStatus {
    nodejs: DependencyInfo,
    pnpm: DependencyInfo,
    ffmpeg: DependencyInfo,
    browsers: DependencyInfo,
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Figma Flow Capture!", name)
}

#[tauri::command]
async fn check_system_dependencies() -> Result<InstallationStatus, String> {
    let mut dependencies = Vec::new();

    // Check Node.js with multiple methods
    let node_check = check_command("node", &["--version"]);
    dependencies.push(SystemDependency {
        name: "Node.js".to_string(),
        installed: node_check.0,
        version: node_check.1,
        install_command: None,
        install_url: Some("https://nodejs.org/".to_string()),
    });

    // Check pnpm with multiple methods
    let pnpm_check = check_command("pnpm", &["--version"]);
    let pnpm_install_cmd = if pnpm_check.0 {
        None
    } else {
        Some(get_pnpm_install_command())
    };
    
    dependencies.push(SystemDependency {
        name: "pnpm".to_string(),
        installed: pnpm_check.0,
        version: pnpm_check.1,
        install_command: pnpm_install_cmd,
        install_url: Some("https://pnpm.io/installation".to_string()),
    });

    // Check FFmpeg with multiple methods
    let ffmpeg_check = check_command("ffmpeg", &["-version"]);
    
    // Add debug logging for FFmpeg detection
    println!("FFmpeg detection result: installed={}, version={:?}", ffmpeg_check.0, ffmpeg_check.1);
    
    if !ffmpeg_check.0 {
        // If not detected, let's log some debug info
        if let Some(path) = find_command_path("ffmpeg") {
            println!("FFmpeg path found: {}", path);
        } else {
            println!("FFmpeg path not found via find_command_path");
        }
        
        // Check specific paths
        let ffmpeg_paths = get_command_search_paths("ffmpeg");
        println!("Checking {} FFmpeg paths:", ffmpeg_paths.len());
        for path in &ffmpeg_paths[..std::cmp::min(5, ffmpeg_paths.len())] {
            if std::fs::metadata(path).is_ok() {
                println!("  ✓ Found: {}", path);
            } else {
                println!("  ✗ Missing: {}", path);
            }
        }
    }
    
    dependencies.push(SystemDependency {
        name: "FFmpeg".to_string(),
        installed: ffmpeg_check.0,
        version: ffmpeg_check.1.as_ref().and_then(|v| v.lines().next().map(|s| s.to_string())),
        install_command: get_ffmpeg_install_command(),
        install_url: Some("https://ffmpeg.org/download.html".to_string()),
    });

    // Check Playwright browsers - check multiple locations
    let browsers_check = check_playwright_browsers();
    dependencies.push(SystemDependency {
        name: "Playwright Browsers".to_string(),
        installed: browsers_check.0,
        version: browsers_check.1,
        install_command: Some("pnpm exec playwright install".to_string()),
        install_url: Some("https://playwright.dev/docs/intro".to_string()),
    });
    
    let ready_to_record = dependencies.iter().all(|dep| dep.installed);
    let project_path = get_project_root_path();

    Ok(InstallationStatus {
        dependencies,
        ready_to_record,
        project_path,
    })
}

#[tauri::command]
async fn install_dependencies() -> Result<String, String> {
    let project_path = get_project_root_path();
    
    // Find pnpm executable
    let pnpm_path = find_command_path("pnpm")
        .ok_or("pnpm not found. Please install pnpm first.")?;
    
    // Change to project directory and install dependencies
    let output = Command::new(pnpm_path)
        .args(&["install"])
        .current_dir(&project_path)
        .output()
        .map_err(|e| format!("Failed to run pnpm install: {}", e))?;

    if output.status.success() {
        Ok("Dependencies installed successfully".to_string())
    } else {
        Err(format!("pnpm install failed: {}", String::from_utf8_lossy(&output.stderr)))
    }
}

#[tauri::command]
async fn install_playwright_browsers() -> Result<String, String> {
    let project_path = get_project_root_path();
    
    // Find pnpm executable
    let pnpm_path = find_command_path("pnpm")
        .ok_or("pnpm not found. Please install pnpm first.")?;
    
    let output = Command::new(pnpm_path)
        .args(&["run", "install-browsers"])
        .current_dir(&project_path)
        .output()
        .map_err(|e| format!("Failed to install browsers: {}", e))?;

    if output.status.success() {
        Ok("Playwright browsers installed successfully".to_string())
    } else {
        Err(format!("Browser installation failed: {}", String::from_utf8_lossy(&output.stderr)))
    }
}

#[tauri::command]
async fn start_recording(options: RecordingOptions) -> Result<RecordingSession, String> {
    println!("Starting recording with options: {:?}", options);
    
    // Create a unique session ID
    let session_id = Uuid::new_v4().to_string();
    let start_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
        .to_string();
    
    // Get the project root directory (parent of gui folder)
    let current_dir = std::env::current_dir()
        .map_err(|e| format!("Failed to get current directory: {}", e))?;
    
    println!("Current directory: {}", current_dir.display());
    
    // Navigate to the main project root (parent of gui)
    let project_root = if current_dir.to_string_lossy().contains("gui") {
        // If we're in gui/src-tauri, go up two levels
        if current_dir.to_string_lossy().contains("src-tauri") {
            let root = current_dir.parent()
                .and_then(|p| p.parent())
                .ok_or("Failed to find project root")?;
            println!("Found project root from src-tauri: {}", root.display());
            root
        } else {
            // If we're just in gui/, go up one level
            let root = current_dir.parent()
                .ok_or("Failed to find project root")?;
            println!("Found project root from gui: {}", root.display());
            root
        }
    } else {
        println!("Already in project root: {}", current_dir.display());
        &current_dir
    };
    
    // Create recordings directory if it doesn't exist
    let recordings_dir = project_root.join("recordings");
    println!("Creating recordings directory: {}", recordings_dir.display());
    std::fs::create_dir_all(&recordings_dir)
        .map_err(|e| format!("Failed to create recordings directory: {}", e))?;
    
    // Prepare the TypeScript recorder command
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    
    // Extract a clean name from the URL for the output file
    let url_parts: Vec<&str> = options.figma_url.split('/').collect();
    let clean_name = url_parts.iter()
        .find(|part| part.contains("FarsiLang") || part.len() > 10)
        .unwrap_or(&"recording")
        .split('?').next()
        .unwrap_or("recording")
        .to_string();
    
    let output_name = format!("{}-{}", clean_name, timestamp);
    let output_path = recordings_dir.join(&output_name);
    
    // Build arguments for the TypeScript recorder CLI
    let mut args = vec![
        "tsx".to_string(),
        "src/cli.ts".to_string(),
        "--url".to_string(),
        options.figma_url.clone(),
        "--mode".to_string(),
        options.recording_mode.clone(),
        "--format".to_string(),
        options.format.clone(),
    ];
    
    if let Some(duration) = options.duration {
        args.push("--duration".to_string());
        args.push(duration.to_string());
    }
    
    if let Some(frame_rate) = options.frame_rate {
        args.push("--frame-rate".to_string());
        args.push(frame_rate.to_string());
    }
    
    // Add optional parameters
    if let Some(width) = options.custom_width {
        args.push("--width".to_string());
        args.push(width.to_string());
    }
    if let Some(height) = options.custom_height {
        args.push("--height".to_string());
        args.push(height.to_string());
    }
    
    args.push("--wait-for-canvas".to_string());
    args.push(options.wait_for_canvas.to_string());
    
    // Find pnpm executable
    let pnpm_path = find_command_path("pnpm")
        .ok_or("pnpm not found. Please install pnpm first.")?;
    
    // Start the recording process in the background
    let mut cmd = std::process::Command::new(pnpm_path);
    cmd.current_dir(project_root).args(&args);
    
    println!("Running command: pnpm {} in directory: {}", args.join(" "), project_root.display());
    
    match cmd.spawn() {
        Ok(child) => {
            let pid = child.id();
            println!("Started recording process with PID: {}", pid);
            
            // Store the child process for later termination
            if let Ok(mut recordings) = ACTIVE_RECORDINGS.lock() {
                recordings.insert(session_id.clone(), child);
            }
            
            Ok(RecordingSession {
                id: session_id,
                status: "recording".to_string(),
                start_time,
                duration: None,
                output_path: Some(output_path.to_string_lossy().to_string()),
                error: None,
            })
        }
        Err(e) => {
            Ok(RecordingSession {
                id: session_id,
                status: "failed".to_string(),
                start_time,
                duration: None,
                output_path: None,
                error: Some(format!("Failed to start recording process: {}", e)),
            })
        }
    }
}

#[tauri::command]
async fn open_recordings_folder() -> Result<(), String> {
    let project_path = get_project_root_path();
    let recordings_path = format!("{}/recordings", project_path);
    
    // Create recordings directory if it doesn't exist
    std::fs::create_dir_all(&recordings_path)
        .map_err(|e| format!("Failed to create recordings directory: {}", e))?;

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&recordings_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&recordings_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&recordings_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
async fn check_dependencies() -> Result<DependencyStatus, String> {
    // Check Node.js
    let node_check = check_command("node", &["--version"]);
    
    // Check pnpm
    let pnpm_check = check_command("pnpm", &["--version"]);
    
    // Check FFmpeg
    let ffmpeg_check = check_command("ffmpeg", &["-version"]);
    
    // Check Playwright browsers
    let browsers_check = check_playwright_browsers();
    
    Ok(DependencyStatus {
        nodejs: DependencyInfo {
            installed: node_check.0,
            version: node_check.1,
        },
        pnpm: DependencyInfo {
            installed: pnpm_check.0,
            version: pnpm_check.1,
        },
        ffmpeg: DependencyInfo {
            installed: ffmpeg_check.0,
            version: ffmpeg_check.1,
        },
        browsers: DependencyInfo {
            installed: browsers_check.0,
            version: browsers_check.1,
        },
    })
}

#[tauri::command]
async fn stop_recording(session_id: String) -> Result<(), String> {
    println!("Stopping recording session: {}", session_id);
    
    if let Ok(mut recordings) = ACTIVE_RECORDINGS.lock() {
        if let Some(mut child) = recordings.remove(&session_id) {
            match child.kill() {
                Ok(()) => {
                    println!("Successfully stopped recording session: {}", session_id);
                    Ok(())
                }
                Err(e) => {
                    Err(format!("Failed to stop recording process: {}", e))
                }
            }
        } else {
            Err(format!("Recording session not found: {}", session_id))
        }
    } else {
        Err("Failed to access recording sessions".to_string())
    }
}

#[tauri::command]
async fn get_recording_status(session_id: String) -> Result<RecordingSession, String> {
    // Check if recording is still active
    if let Ok(recordings) = ACTIVE_RECORDINGS.lock() {
        if recordings.contains_key(&session_id) {
            return Ok(RecordingSession {
                id: session_id,
                status: "recording".to_string(),
                start_time: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs()
                    .to_string(),
                duration: None,
                output_path: None,
                error: None,
            });
        }
    }
    
    // If not in active recordings, assume it's completed or failed
    Ok(RecordingSession {
        id: session_id,
        status: "completed".to_string(),
        start_time: "".to_string(),
        duration: None,
        output_path: None,
        error: None,
    })
}

#[tauri::command]
async fn list_recordings() -> Result<Vec<String>, String> {
    let project_path = get_project_root_path();
    let recordings_path = format!("{}/recordings", project_path);
    
    let mut recordings = Vec::new();
    
    if let Ok(entries) = std::fs::read_dir(&recordings_path) {
        for entry in entries {
            if let Ok(entry) = entry {
                if let Some(name) = entry.file_name().to_str() {
                    recordings.push(name.to_string());
                }
            }
        }
    }
    
    Ok(recordings)
}

fn check_playwright_browsers() -> (bool, Option<String>) {
    // First try using detected pnpm path
    if let Some(pnpm_path) = find_command_path("pnpm") {
        if let (true, version) = check_command(&pnpm_path, &["exec", "playwright", "--version"]) {
            return (true, version);
        }
    }
    
    // Try global playwright command with path detection
    if let (true, version) = check_command("playwright", &["--version"]) {
        return (true, version);
    }
    
    // Try npx playwright
    if let (true, version) = check_command("npx", &["playwright", "--version"]) {
        return (true, version);
    }
    
    // Try checking in the main project root (not GUI folder)
    let project_path = get_project_root_path();
    let main_project_playwright = format!("{}/node_modules/.bin/playwright", project_path);
    if let (true, version) = check_command(&main_project_playwright, &["--version"]) {
        return (true, version);
    }
    
    // Try checking if browsers are installed by looking for browser directories
    // Playwright typically installs browsers in different locations per OS
    let home_dir = env::var("HOME").unwrap_or_default();
    
    #[cfg(target_os = "macos")]
    let playwright_cache = format!("{}/Library/Caches/ms-playwright", home_dir);
    
    #[cfg(target_os = "windows")]
    let playwright_cache = if let Ok(appdata) = env::var("LOCALAPPDATA") {
        format!("{}\\ms-playwright", appdata)
    } else if let Ok(userprofile) = env::var("USERPROFILE") {
        format!("{}\\AppData\\Local\\ms-playwright", userprofile)
    } else {
        format!("{}\\ms-playwright", home_dir)
    };
    
    #[cfg(target_os = "linux")]
    let playwright_cache = format!("{}/.cache/ms-playwright", home_dir);
    
    if let Ok(entries) = std::fs::read_dir(&playwright_cache) {
        let browser_count = entries.filter_map(|entry| entry.ok()).count();
        if browser_count > 0 {
            return (true, Some("browsers installed".to_string()));
        }
    }
    
    (false, None)
}

fn check_command(command: &str, args: &[&str]) -> (bool, Option<String>) {
    // First, try with enhanced shell command that sources profiles
    if let (true, version) = check_command_with_shell(command, args) {
        return (true, version);
    }
    
    // Second, try directly using found path
    if let Some(cmd_path) = find_command_path(command) {
        let direct_output = Command::new(&cmd_path)
            .args(args)
            .output();

        if let Ok(output) = direct_output {
            if output.status.success() {
                let output_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let version = if output_str.is_empty() {
                    Some("installed".to_string())
                } else {
                    Some(output_str)
                };
                return (true, version);
            }
        }
    }
    
    // Third, try specific paths by command name
    if command == "ffmpeg" {
        if let (true, version) = check_ffmpeg_specific() {
            return (true, version);
        }
    }

    (false, None)
}

fn check_command_with_shell(command: &str, args: &[&str]) -> (bool, Option<String>) {
    #[cfg(target_os = "windows")]
    let shell_cmd = format!("{} {}", command, args.join(" "));

    #[cfg(not(target_os = "windows"))]
    let shell_cmd = format!(
        // Source the user's profile to get Homebrew and user PATH
        "source ~/.zshrc 2>/dev/null || true; source ~/.bash_profile 2>/dev/null || true; source ~/.profile 2>/dev/null || true; {} {}",
        command,
        args.join(" ")
    );

    let output = if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(&["/C", &shell_cmd])
            .env("PATH", std::env::var("PATH").unwrap_or_default())
            .output()
    } else {
        Command::new("sh")
            .arg("-c")
            .arg(&shell_cmd)
            .env("PATH", std::env::var("PATH").unwrap_or_default())
            .output()
    };

    if let Ok(output) = output {
        if output.status.success() {
            let output_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let version = if output_str.is_empty() {
                let stderr_str = String::from_utf8_lossy(&output.stderr).trim().to_string();
                if !stderr_str.is_empty() {
                    Some(stderr_str)
                } else {
                    Some("installed".to_string())
                }
            } else {
                Some(output_str)
            };
            return (true, version);
        }
    }

    (false, None)
}

// Try specific paths for FFmpeg
fn check_ffmpeg_specific() -> (bool, Option<String>) {
    println!("Running FFmpeg-specific detection...");
    
    // Get all common FFmpeg paths for this platform
    let ffmpeg_paths = get_command_search_paths("ffmpeg");
    println!("Checking {} FFmpeg-specific paths", ffmpeg_paths.len());

    // Try each path directly
    for (i, path) in ffmpeg_paths.iter().enumerate() {
        if i < 10 { // Log first 10 paths
            println!("  Checking path {}: {}", i + 1, path);
        }
        
        if let Ok(metadata) = std::fs::metadata(&path) {
            println!("    ✓ File exists at: {}", path);
            // If it exists and is executable or is a file
            if metadata.is_file() || cfg!(target_os = "windows") {
                let direct_output = Command::new(&path)
                    .args(&["-version"])
                    .output();

                if let Ok(output) = direct_output {
                    if output.status.success() {
                        let output_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                        if !output_str.is_empty() {
                            println!("    ✓ FFmpeg working at: {}", path);
                            // Get first line as version
                            let version = output_str.lines().next().map(|s| s.to_string());
                            return (true, version);
                        }
                        // Empty output but success status means it's installed
                        println!("    ✓ FFmpeg detected (empty output) at: {}", path);
                        return (true, Some("installed".to_string()));
                    } else {
                        println!("    ✗ FFmpeg command failed at: {}", path);
                    }
                } else {
                    println!("    ✗ Failed to execute: {}", path);
                }
            }
        } else if i < 10 {
            println!("    ✗ File not found: {}", path);
        }
    }

    // Enhance path environment variable lookup with common brew paths
    #[cfg(target_os = "macos")]
    {
        println!("Trying macOS-specific FFmpeg detection...");
        // On macOS, try with enhanced PATH including common Homebrew locations
        let extra_brew_paths = vec![
            "/opt/homebrew/bin", 
            "/usr/local/bin",
            "/opt/homebrew/opt/ffmpeg/bin"
        ];
        
        // Get existing PATH or empty string
        let mut path_env = std::env::var("PATH").unwrap_or_default();
        println!("Current PATH length: {}", path_env.len());
        
        // Add brew paths
        for brew_path in extra_brew_paths {
            if !path_env.contains(brew_path) {
                path_env = format!("{}:{}",brew_path, path_env);
                println!("Added to PATH: {}", brew_path);
            }
        }
        
        // Try with enhanced PATH
        let shell_cmd = "ffmpeg -version";
        let output = Command::new("sh")
            .args(&["-c", shell_cmd])
            .env("PATH", path_env)
            .output();
            
        if let Ok(output) = output {
            if output.status.success() {
                let output_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !output_str.is_empty() {
                    println!("✓ FFmpeg found via enhanced PATH");
                    let version = output_str.lines().next().map(|s| s.to_string());
                    return (true, version);
                }
                println!("✓ FFmpeg detected via enhanced PATH (empty output)");
                return (true, Some("installed".to_string()));
            } else {
                println!("✗ FFmpeg command failed via enhanced PATH");
            }
        } else {
            println!("✗ Failed to execute FFmpeg via enhanced PATH");
        }
    }

    println!("FFmpeg-specific detection failed");
    (false, None)
}

fn find_command_path(command: &str) -> Option<String> {
    // First try: For bundled apps, use shell execution with profiles to inherit PATH
    let shell_command = if cfg!(target_os = "windows") {
        format!("where {}", command)
    } else {
        // Source the user's profile to get Homebrew and user PATH, then find command
        format!("source ~/.zshrc 2>/dev/null || true; source ~/.bash_profile 2>/dev/null || true; source ~/.profile 2>/dev/null || true; which {}", command)
    };

    let shell_result = if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(&["/C", &shell_command])
            .env("PATH", std::env::var("PATH").unwrap_or_default())
            .output()
    } else {
        Command::new("sh")
            .args(&["-c", &shell_command])
            .env("PATH", std::env::var("PATH").unwrap_or_default())
            .output()
    };

    if let Ok(output) = shell_result {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
    }
    
    // Second try: Check manually from get_command_search_paths
    let potential_paths = get_command_search_paths(command);
    for path in potential_paths {
        if let Ok(metadata) = std::fs::metadata(&path) {
            // If it exists and is a file (or we're on Windows, where .exe is required)
            if metadata.is_file() || cfg!(target_os = "windows") {
                return Some(path);
            }
        }
    }

    // Fallback: just return the command name and let the shell handle it
    Some(command.to_string())
}

fn get_pnpm_install_command() -> String {
    #[cfg(target_os = "macos")]
    return "brew install pnpm".to_string();
    
    #[cfg(target_os = "windows")]
    return "npm install -g pnpm".to_string();
    
    #[cfg(target_os = "linux")]
    return "curl -fsSL https://get.pnpm.io/install.sh | sh -".to_string();
    
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    return "npm install -g pnpm".to_string();
}

fn get_command_search_paths(command: &str) -> Vec<String> {
    let mut paths = Vec::new();
    
    // Get PATH environment variable and split properly for the platform
    if let Ok(path_env) = env::var("PATH") {
        #[cfg(target_os = "windows")]
        let path_separator = ';';
        #[cfg(not(target_os = "windows"))]
        let path_separator = ':';
        
        for path in path_env.split(path_separator) {
            if !path.trim().is_empty() {
                paths.push(format!("{}/{}", path.trim(), command));
            }
        }
    }

    // Platform-specific common paths
    #[cfg(target_os = "macos")]
    {
        // macOS-specific paths - prioritize common locations
        let macos_paths = vec![
            format!("/opt/homebrew/bin/{}", command),        // Homebrew (Apple Silicon) - most common
            format!("/usr/local/bin/{}", command),           // Homebrew (Intel)
            format!("/usr/bin/{}", command),                 // System binaries
            format!("/bin/{}", command),                     // Core binaries
        ];
        paths.extend(macos_paths);

        // Check user's home directory for npm global packages
        if let Ok(home) = env::var("HOME") {
            paths.push(format!("{}/.npm-global/bin/{}", home, command));
            paths.push(format!("{}/bin/{}", home, command));
            // Check for nvm installations
            paths.push(format!("{}/.nvm/current/bin/{}", home, command));
            // Check for volta installations
            paths.push(format!("{}/.volta/bin/{}", home, command));
            // Check for pnpm specific location
            paths.push(format!("{}/Library/pnpm/{}", home, command));
        }

        // Special handling for specific commands
        match command {
            "node" => {
                paths.extend(vec![
                    "/Applications/Node.js/bin/node".to_string(),
                ]);
                // Check for nvm versions
                if let Ok(home) = env::var("HOME") {
                    if let Ok(entries) = std::fs::read_dir(format!("{}/.nvm/versions/node", home)) {
                        for entry in entries.flatten() {
                            paths.push(format!("{}/bin/node", entry.path().display()));
                        }
                    }
                }
            }
            "ffmpeg" => {
                paths.extend(vec![
                    "/opt/homebrew/bin/ffmpeg".to_string(),              // Homebrew Apple Silicon primary
                    "/usr/local/bin/ffmpeg".to_string(),                 // Homebrew Intel primary
                    "/opt/homebrew/opt/ffmpeg/bin/ffmpeg".to_string(),   // Homebrew Apple Silicon formula specific
                    "/usr/local/opt/ffmpeg/bin/ffmpeg".to_string(),      // Homebrew Intel formula specific
                    "/Applications/FFmpeg/ffmpeg".to_string(),           // Manual installation
                    "/Applications/FFmpeg/bin/ffmpeg".to_string(),       // Manual installation with bin
                    "/usr/local/Cellar/ffmpeg/*/bin/ffmpeg".to_string(), // Cellar installation pattern
                    "/opt/homebrew/Cellar/ffmpeg/*/bin/ffmpeg".to_string(), // Apple Silicon Cellar
                ]);
                
                // Also check for Cellar installations dynamically
                if let Ok(home) = env::var("HOME") {
                    // Check both Intel and Apple Silicon Homebrew Cellar paths
                    let cellar_paths = vec![
                        "/usr/local/Cellar/ffmpeg",
                        "/opt/homebrew/Cellar/ffmpeg"
                    ];
                    
                    for cellar_path in cellar_paths {
                        if let Ok(entries) = std::fs::read_dir(cellar_path) {
                            for entry in entries.flatten() {
                                if entry.file_type().map_or(false, |ft| ft.is_dir()) {
                                    let ffmpeg_path = format!("{}/bin/ffmpeg", entry.path().display());
                                    paths.push(ffmpeg_path);
                                }
                            }
                        }
                    }
                    
                    // MacPorts paths
                    paths.push("/opt/local/bin/ffmpeg".to_string());
                    
                    // User local installations
                    paths.push(format!("{}/bin/ffmpeg", home));
                    paths.push(format!("{}/.local/bin/ffmpeg", home));
                }
            }
            "pnpm" => {
                if let Ok(home) = env::var("HOME") {
                    paths.push(format!("{}/.local/share/pnpm/pnpm", home));
                    paths.push(format!("{}/Library/pnpm/pnpm", home));
                    // Check for global npm installation
                    paths.push(format!("{}/.npm-global/bin/pnpm", home));
                }
                // Common pnpm locations
                paths.extend(vec![
                    "/usr/local/lib/node_modules/pnpm/bin/pnpm.js".to_string(),
                    "/opt/homebrew/lib/node_modules/pnpm/bin/pnpm.js".to_string(),
                ]);
            }
            _ => {}
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Windows-specific paths
        let windows_paths = vec![
            format!("C:\\Program Files\\nodejs\\{}.exe", command),
            format!("C:\\Program Files (x86)\\nodejs\\{}.exe", command),
            format!("C:\\Windows\\System32\\{}.exe", command),
            format!("C:\\Windows\\{}.exe", command),
        ];
        paths.extend(windows_paths);

        // Check user's AppData for npm global packages
        if let Ok(appdata) = env::var("APPDATA") {
            paths.push(format!("{}\\npm\\{}.cmd", appdata, command));
            paths.push(format!("{}\\npm\\{}.exe", appdata, command));
        }

        if let Ok(userprofile) = env::var("USERPROFILE") {
            paths.push(format!("{}\\AppData\\Roaming\\npm\\{}.cmd", userprofile, command));
            paths.push(format!("{}\\AppData\\Roaming\\npm\\{}.exe", userprofile, command));
        }

        // Special handling for specific commands
        match command {
            "ffmpeg" => {
                paths.extend(vec![
                    "C:\\Program Files\\FFmpeg\\bin\\ffmpeg.exe".to_string(),
                    "C:\\Program Files (x86)\\FFmpeg\\bin\\ffmpeg.exe".to_string(),
                    "C:\\ffmpeg\\bin\\ffmpeg.exe".to_string(),
                ]);
                
                // Check chocolatey installation
                if let Ok(programdata) = env::var("ProgramData") {
                    paths.push(format!("{}\\chocolatey\\bin\\ffmpeg.exe", programdata));
                }
            }
            "pnpm" => {
                if let Ok(appdata) = env::var("APPDATA") {
                    paths.push(format!("{}\\npm\\pnpm.cmd", appdata));
                }
            }
            _ => {}
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Linux-specific paths
        let linux_paths = vec![
            format!("/usr/bin/{}", command),
            format!("/usr/local/bin/{}", command),
            format!("/bin/{}", command),
            format!("/snap/bin/{}", command),              // Snap packages
            format!("/var/lib/flatpak/exports/bin/{}", command), // Flatpak
        ];
        paths.extend(linux_paths);

        // Check user's home directory
        if let Ok(home) = env::var("HOME") {
            paths.push(format!("{}/.local/bin/{}", home, command));
            paths.push(format!("{}/bin/{}", home, command));
            paths.push(format!("{}/.npm-global/bin/{}", home, command));
            // Check for nvm installations
            paths.push(format!("{}/.nvm/current/bin/{}", home, command));
        }

        // Special handling for specific commands
        match command {
            "node" => {
                // Check for nvm versions
                if let Ok(home) = env::var("HOME") {
                    if let Ok(entries) = std::fs::read_dir(format!("{}/.nvm/versions/node", home)) {
                        for entry in entries.flatten() {
                            paths.push(format!("{}/bin/node", entry.path().display()));
                        }
                    }
                }
            }
            "pnpm" => {
                if let Ok(home) = env::var("HOME") {
                    paths.push(format!("{}/.local/share/pnpm/pnpm", home));
                }
            }
            _ => {}
        }
    }

    // Remove duplicates while preserving order
    let mut unique_paths = Vec::new();
    for path in paths {
        if !unique_paths.contains(&path) {
            unique_paths.push(path);
        }
    }

    unique_paths
}

fn get_ffmpeg_install_command() -> Option<String> {
    #[cfg(target_os = "macos")]
    return Some("brew install ffmpeg".to_string());
    
    #[cfg(target_os = "windows")]
    return Some("choco install ffmpeg".to_string());
    
    #[cfg(target_os = "linux")]
    return Some("sudo apt install ffmpeg".to_string());
    
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    return None;
}

fn get_project_root_path() -> String {
    // Get the directory containing the Tauri app, then go up to find the project root
    let exe_path = env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
    let _current_dir = exe_path.parent().unwrap_or_else(|| std::path::Path::new("."));
    
    // During development, we're in gui/src-tauri/target/debug
    // During production, we need to find the project root differently
    if let Ok(cwd) = env::current_dir() {
        if cwd.join("src").exists() && cwd.join("package.json").exists() {
            // We're in the project root
            return cwd.to_string_lossy().to_string();
        } else if cwd.parent().map_or(false, |p| p.join("src").exists()) {
            // We're in gui/, go up one level
            return cwd.parent().unwrap().to_string_lossy().to_string();
        }
    }
    
    // Fallback to current directory
    env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .to_string_lossy()
        .to_string()
}

fn get_main_project_path() -> String {
    // This function gets the main project path (not the GUI subfolder)
    if let Ok(cwd) = env::current_dir() {
        // If we're in gui/src-tauri, go up two levels
        if cwd.to_string_lossy().contains("gui/src-tauri") {
            if let Some(parent) = cwd.parent().and_then(|p| p.parent()) {
                return parent.to_string_lossy().to_string();
            }
        }
        // If we're in gui/, go up one level  
        else if cwd.to_string_lossy().ends_with("gui") {
            if let Some(parent) = cwd.parent() {
                return parent.to_string_lossy().to_string();
            }
        }
    }
    
    // Fallback to get_project_root_path
    get_project_root_path()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            check_system_dependencies,
            install_dependencies,
            install_playwright_browsers,
            start_recording,
            open_recordings_folder,
            check_dependencies,
            stop_recording,
            get_recording_status,
            list_recordings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
