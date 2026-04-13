// set-icon.js - Manually set icon on Windows .exe file
const rcedit = require('rcedit');
const path = require('path');
const fs = require('fs');
const productName = 'GetVideosLocally';

// Use absolute paths to avoid any path resolution issues
const exePath = path.resolve(__dirname, 'dist', `${productName}-win32-x64`, `${productName}.exe`);
const iconPath = path.resolve(__dirname, 'public', 'Logo_1.ico');

console.log('🔧 Setting icon on executable...');
console.log('   Working directory:', __dirname);
console.log('   EXE:', exePath);
console.log('   Icon:', iconPath);

// Check if files exist
if (!fs.existsSync(exePath)) {
  console.error('❌ Executable not found:', exePath);
  console.error('   Make sure the build completed successfully.');
  process.exit(1);
}

if (!fs.existsSync(iconPath)) {
  console.error('❌ Icon file not found:', iconPath);
  process.exit(1);
}

// Check icon file size (should not be empty)
const iconStats = fs.statSync(iconPath);
if (iconStats.size === 0) {
  console.error('❌ Icon file is empty:', iconPath);
  process.exit(1);
}

console.log('   Icon file size:', iconStats.size, 'bytes');
console.log('   Setting icon...\n');

// Set icon with comprehensive version info
rcedit(exePath, {
  icon: iconPath,
  'version-string': {
    FileDescription: 'GetVideosLocally - Video Downloader',
    ProductName: productName,
    CompanyName: 'FCGLITCHES',
    LegalCopyright: '© 2024-2026 FCGLITCHES',
    OriginalFilename: `${productName}.exe`,
    InternalName: productName
  },
  'file-version': '1.0.0',
  'product-version': '1.0.0'
})
  .then(() => {
    console.log('✅ Icon successfully set on executable!');
    console.log('\n💡 If the icon doesn\'t appear immediately:');
    console.log('   1. Refresh Windows Explorer (F5)');
    console.log('   2. Clear icon cache: ie4uinit.exe -show');
    console.log('   3. Restart Windows Explorer: taskkill /f /im explorer.exe && start explorer.exe');
    console.log('   4. Move the .exe to a different location and back');
    console.log('   5. Check if icon shows in Properties → Details tab\n');

    // Try to clear icon cache automatically
    const { exec } = require('child_process');
    exec('ie4uinit.exe -show', (error) => {
      if (error) {
        console.log('   Note: Could not auto-clear icon cache. Please run manually.');
      } else {
        console.log('   ✓ Icon cache cleared automatically');
      }
    });
  })
  .catch((error) => {
    console.error('\n❌ Error setting icon:', error.message);
    console.error('   Full error:', error);
    console.error('\n💡 Troubleshooting:');
    console.error('   1. Verify icon file is valid ICO format');
    console.error('   2. Ensure icon has multiple sizes (16x16, 32x32, 48x48, 256x256)');
    console.error('   3. Try converting PNG to ICO using online converter');
    console.error('   4. Check if .exe is not locked by another process');
    process.exit(1);
  });

