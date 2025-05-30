// Quick test script to verify Tauri API functionality
// This can be run in the browser console when the app is open

async function testDependencyAPI() {
  try {
    // Test the check_dependencies command
    const result = await window.__TAURI__.core.invoke('check_dependencies');
    console.log('Dependency Status:', result);
    
    // Pretty print the results
    console.log('Node.js:', result.nodejs.installed ? `✅ ${result.nodejs.version}` : '❌ Not installed');
    console.log('pnpm:', result.pnpm.installed ? `✅ ${result.pnpm.version}` : '❌ Not installed');
    console.log('FFmpeg:', result.ffmpeg.installed ? `✅ ${result.ffmpeg.version?.substring(0, 50)}...` : '❌ Not installed');
    console.log('Playwright Browsers:', result.browsers.installed ? `✅ ${result.browsers.version}` : '❌ Not installed');
    
    return result;
  } catch (error) {
    console.error('Error testing API:', error);
  }
}

// Run the test automatically
testDependencyAPI();
