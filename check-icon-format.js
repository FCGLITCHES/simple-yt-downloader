// check-icon-format.js - Check if ICO file has proper multiple sizes
const fs = require('fs');
const path = require('path');

const iconPath = path.resolve(__dirname, 'public', 'Logo_1.ico');

console.log('🔍 Checking ICO file format...\n');
console.log('   Icon path:', iconPath);

if (!fs.existsSync(iconPath)) {
  console.error('❌ Icon file not found:', iconPath);
  process.exit(1);
}

const iconData = fs.readFileSync(iconPath);
const iconSize = iconData.length;

console.log('   File size:', iconSize, 'bytes');

// ICO file structure check
// ICO files start with 00 00 (2 bytes) and have a directory structure
// Minimum valid ICO should be at least 22 bytes (6 byte header + 16 byte directory entry)

if (iconSize < 22) {
  console.error('\n❌ Icon file is too small. Valid ICO files need at least 22 bytes.');
  console.error('   This might not be a valid ICO file.');
  process.exit(1);
}

// Check ICO header (first 6 bytes)
const header = iconData.readUInt16LE(0); // Reserved (should be 0)
const type = iconData.readUInt16LE(2);   // Type: 1 = ICO, 2 = CUR
const count = iconData.readUInt16LE(4);   // Number of images

console.log('\n📋 ICO File Structure:');
console.log('   Header:', header === 0 ? '✓ Valid' : '✗ Invalid');
console.log('   Type:', type === 1 ? '✓ ICO' : type === 2 ? '✓ CURSOR' : '✗ Unknown');
console.log('   Number of images:', count);

if (count === 0) {
  console.error('\n❌ No images found in ICO file!');
  process.exit(1);
}

console.log('\n📐 Image Sizes in ICO:');
let hasSmall = false;
let hasMedium = false;
let hasLarge = false;
let hasXLarge = false;

for (let i = 0; i < count; i++) {
  const offset = 6 + (i * 16);
  if (offset + 16 > iconSize) break;
  
  const width = iconData.readUInt8(offset) || 256;
  const height = iconData.readUInt8(offset + 1) || 256;
  const colors = iconData.readUInt8(offset + 2);
  const reserved = iconData.readUInt8(offset + 3);
  const planes = iconData.readUInt16LE(offset + 4);
  const bpp = iconData.readUInt16LE(offset + 6);
  const size = iconData.readUInt32LE(offset + 8);
  const imageOffset = iconData.readUInt32LE(offset + 12);
  
  console.log(`   Image ${i + 1}: ${width}x${height} (${bpp} bpp, ${size} bytes)`);
  
  if (width === 16 || height === 16) hasSmall = true;
  if (width === 32 || height === 32) hasMedium = true;
  if (width === 48 || height === 48) hasLarge = true;
  if (width === 256 || height === 256) hasXLarge = true;
}

console.log('\n✅ Recommended Sizes:');
console.log('   16x16:', hasSmall ? '✓ Present' : '✗ Missing');
console.log('   32x32:', hasMedium ? '✓ Present' : '✗ Missing');
console.log('   48x48:', hasLarge ? '✓ Present' : '✗ Missing');
console.log('   256x256:', hasXLarge ? '✓ Present' : '✗ Missing');

const recommendedSizes = [hasSmall, hasMedium, hasLarge, hasXLarge].filter(x => x).length;

if (recommendedSizes < 2) {
  console.error('\n⚠️  WARNING: Icon has fewer than 2 recommended sizes.');
  console.error('   Windows may not display the icon correctly.');
  console.error('   Recommended: Include at least 16x16, 32x32, 48x48, and 256x256.');
  console.error('\n💡 To fix:');
  console.error('   1. Use an online ICO converter (like https://convertio.co/png-ico/)');
  console.error('   2. Or use ImageMagick: magick convert Logo_1.png -define icon:auto-resize=256,128,64,48,32,16 Logo_1.ico');
  process.exit(1);
} else {
  console.log('\n✅ Icon format looks good!');
  console.log(`   ${recommendedSizes} recommended sizes found.`);
}

