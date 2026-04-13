// Diagnostics bundle generator - collects system info for bug reports
const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const packageJson = require('../package.json');

const execAsync = promisify(exec);

async function getToolVersion(executable) {
  return new Promise((resolve) => {
    const proc = spawn(executable, ['--version'], { shell: true });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', () => {
      const output = stdout.trim() || stderr.trim();
      resolve(output || 'Not available');
    });

    proc.on('error', () => {
      resolve('Not installed or not accessible');
    });
  });
}

async function getYtDlpExtractorInfo(executable) {
  return new Promise((resolve) => {
    const proc = spawn(executable, ['--list-extractors'], { shell: true });
    let stdout = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.on('close', () => {
      const extractors = stdout.trim().split('\n').filter(line => line.trim());
      resolve(extractors.length > 0 ? extractors.length : 'Unknown');
    });

    proc.on('error', () => {
      resolve('Not available');
    });
  });
}

async function generateDiagnostics() {
  console.log('📦 Generating diagnostics bundle...\n');

  const diagnostics = {
    timestamp: new Date().toISOString(),
    application: {
      name: packageJson.name,
      version: packageJson.version,
      description: packageJson.description
    },
    system: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      osType: os.type(),
      osRelease: os.release(),
      osVersion: os.version(),
      totalMemory: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB`,
      cpuCount: os.cpus().length
    },
    tools: {},
    paths: {
      appDirectory: __dirname.replace(/scripts$/, ''),
      binDirectory: path.join(__dirname, '..', 'bin'),
      userDataPath: process.env.APPDATA || process.env.HOME || 'Unknown'
    },
    environment: {
      electron: process.versions.electron || 'N/A',
      chrome: process.versions.chrome || 'N/A',
      v8: process.versions.v8 || 'N/A'
    },
    flags: {
      // Common flags that might affect behavior
      nodeEnv: process.env.NODE_ENV || 'production',
      ytdlpPath: process.env.YTDLP_PATH || 'default',
      ffmpegPath: process.env.FFMPEG_PATH || 'default'
    }
  };

  // Check yt-dlp
  const ytdlpPath = path.join(__dirname, '..', 'bin', 'yt-dlp.exe');
  const ytdlpExecutable = fs.existsSync(ytdlpPath) ? ytdlpPath : 'yt-dlp';
  console.log('🔍 Checking yt-dlp...');
  diagnostics.tools.ytdlp = {
    version: await getToolVersion(ytdlpExecutable),
    path: ytdlpExecutable,
    extractorCount: await getYtDlpExtractorInfo(ytdlpExecutable)
  };

  // Check FFmpeg
  const ffmpegPath = path.join(__dirname, '..', 'bin', 'ffmpeg.exe');
  const ffmpegExecutable = fs.existsSync(ffmpegPath) ? ffmpegPath : 'ffmpeg';
  console.log('🔍 Checking FFmpeg...');
  diagnostics.tools.ffmpeg = {
    version: await getToolVersion(ffmpegExecutable),
    path: ffmpegExecutable
  };

  // Check Node binary (if available)
  const nodePath = path.join(__dirname, '..', 'bin', 'node.exe');
  const nodeExecutable = fs.existsSync(nodePath) ? nodePath : process.execPath;
  if (fs.existsSync(nodePath)) {
    console.log('🔍 Checking bundled Node...');
    diagnostics.tools.node = {
      version: await getToolVersion(nodeExecutable),
      path: nodeExecutable
    };
  }

  // Format output
  const output = `# SimplyYTD Diagnostics Bundle
Generated: ${diagnostics.timestamp}

## Application Information
- Name: ${diagnostics.application.name}
- Version: ${diagnostics.application.version}
- Description: ${diagnostics.application.description}

## System Information
- Platform: ${diagnostics.system.platform}
- Architecture: ${diagnostics.system.arch}
- Node.js Version: ${diagnostics.system.nodeVersion}
- OS: ${diagnostics.system.osType} ${diagnostics.system.osRelease}
- OS Version: ${diagnostics.system.osVersion}
- Total Memory: ${diagnostics.system.totalMemory}
- CPU Cores: ${diagnostics.system.cpuCount}

## Tool Versions
### yt-dlp
- Version: ${diagnostics.tools.ytdlp.version}
- Path: ${diagnostics.tools.ytdlp.path}
- Supported Extractors: ${diagnostics.tools.ytdlp.extractorCount}

### FFmpeg
- Version: ${diagnostics.tools.ffmpeg.version}
- Path: ${diagnostics.tools.ffmpeg.path}

${diagnostics.tools.node ? `### Node (Bundled)
- Version: ${diagnostics.tools.node.version}
- Path: ${diagnostics.tools.node.path}
` : ''}

## Environment
- Electron Version: ${diagnostics.environment.electron}
- Chrome Version: ${diagnostics.environment.chrome}
- V8 Version: ${diagnostics.environment.v8}

## Configuration Flags
- NODE_ENV: ${diagnostics.flags.nodeEnv}
- YTDLP_PATH: ${diagnostics.flags.ytdlpPath}
- FFMPEG_PATH: ${diagnostics.flags.ffmpegPath}

## Paths
- Application Directory: ${diagnostics.paths.appDirectory}
- Bin Directory: ${diagnostics.paths.binDirectory}
- User Data Path: ${diagnostics.paths.userDataPath}

---

**Note:** This diagnostics bundle contains only system and version information. No personal data, URLs, or sensitive information is included.
`;

  // Save to file
  const outputPath = path.join(__dirname, '..', 'diagnostics.txt');
  fs.writeFileSync(outputPath, output, 'utf8');

  console.log(`\n✅ Diagnostics bundle generated: ${outputPath}`);
  console.log('\n📋 Diagnostics Summary:');
  console.log(output);
  
  return output;
}

// If run directly, generate diagnostics
if (require.main === module) {
  generateDiagnostics().catch((error) => {
    console.error('❌ Error generating diagnostics:', error);
    process.exit(1);
  });
}

module.exports = { generateDiagnostics };

