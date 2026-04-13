// verify-icon.js - Verify icon is properly embedded in the executable
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const exePath = path.resolve(__dirname, 'dist', 'SimplyYTD-win32-x64', 'SimplyYTD.exe');
const iconPath = path.resolve(__dirname, 'public', 'Logo_1.ico');

console.log('🔍 Verifying icon setup...\n');

// Check if files exist
if (!fs.existsSync(exePath)) {
  console.error('❌ Executable not found:', exePath);
  process.exit(1);
}

if (!fs.existsSync(iconPath)) {
  console.error('❌ Icon file not found:', iconPath);
  process.exit(1);
}

console.log('✓ Executable exists:', exePath);
console.log('✓ Icon file exists:', iconPath);

// Get file stats
const exeStats = fs.statSync(exePath);
const iconStats = fs.statSync(iconPath);

console.log('\n📊 File Information:');
console.log('   EXE size:', (exeStats.size / 1024 / 1024).toFixed(2), 'MB');
console.log('   Icon size:', iconStats.size, 'bytes');
console.log('   Icon modified:', iconStats.mtime.toLocaleString());

// Try to extract icon info from EXE (Windows-specific)
if (process.platform === 'win32') {
  console.log('\n🔧 Attempting to verify icon in executable...');
  
  // Use PowerShell to check file properties
  const psCommand = `Get-ItemProperty -Path "${exePath}" | Select-Object Name, Length, LastWriteTime, VersionInfo`;
  exec(`powershell -Command "${psCommand.replace(/"/g, '\\"')}"`, (error, stdout, stderr) => {
    if (error) {
      console.log('   Note: Could not extract detailed file info');
    } else {
      console.log(stdout);
    }
    
    console.log('\n💡 Manual Verification Steps:');
    console.log('   1. Right-click SimplyYTD.exe → Properties');
    console.log('   2. Check the "Details" tab for version info');
    console.log('   3. Check if icon appears in the top-left of Properties window');
    console.log('   4. Navigate to dist\\SimplyYTD-win32-x64\\ and check icon in Explorer');
    console.log('\n📝 Icon should appear if:');
    console.log('   - Windows Explorer is refreshed (F5)');
    console.log('   - Icon cache is cleared');
    console.log('   - ICO file contains multiple sizes (16, 32, 48, 256px)');
  });
} else {
  console.log('\n⚠️  This script is designed for Windows');
  console.log('   Icon verification on this platform may not be accurate');
}

