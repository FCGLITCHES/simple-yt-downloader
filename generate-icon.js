// generate-icon.js - Generate a multi-size ICO file from PNG using sharp
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const pngPath = path.resolve(__dirname, 'assets', 'Logo 1.png');
const icoPath = path.resolve(__dirname, 'public', 'Logo1.ico');

console.log('🎨 Generating multi-size ICO file...\n');
console.log('   Source PNG:', pngPath);
console.log('   Output ICO:', icoPath);

if (!fs.existsSync(pngPath)) {
  console.error('❌ PNG file not found:', pngPath);
  process.exit(1);
}

// Sizes for ICO file (Windows compatible sizes)
const sizes = [16, 24, 32, 48, 64, 128, 256];

function encodeIcoImageDirectoryEntry(size, imageBuffer, imageOffset) {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(imageBuffer.length, 8);
  entry.writeUInt32LE(imageOffset, 12);
  return entry;
}

function createIcoFromPngBuffers(iconImages) {
  const headerLength = 6;
  const entryLength = 16;
  const imageDirectoryLength = iconImages.length * entryLength;
  const header = Buffer.alloc(headerLength);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(iconImages.length, 4);

  let imageOffset = headerLength + imageDirectoryLength;
  const entries = iconImages.map(({ size, buffer }) => {
    const entry = encodeIcoImageDirectoryEntry(size, buffer, imageOffset);
    imageOffset += buffer.length;
    return entry;
  });

  return Buffer.concat([
    header,
    ...entries,
    ...iconImages.map(({ buffer }) => buffer)
  ]);
}

console.log('\n📐 Resizing PNG to multiple sizes:', sizes.join(', '));
console.log('   Processing images...\n');

// Resize PNG to each size and collect buffers
Promise.all(
  sizes.map(size =>
    sharp(pngPath)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toBuffer()
      .then(buffer => ({ size, buffer }))
  )
)
  .then(iconImages => {
    console.log('   ✓ Generated', iconImages.length, 'sized versions');
    console.log('   Creating ICO file...\n');

    return createIcoFromPngBuffers(iconImages);
  })
  .then(icoBuffer => {
    // Write ICO file
    fs.writeFileSync(icoPath, icoBuffer);

    const stats = fs.statSync(icoPath);
    console.log('✅ ICO file generated successfully!');
    console.log('   Output size:', stats.size, 'bytes');
    console.log('   Location:', icoPath);
    console.log('   Contains sizes:', sizes.join(', '));
    console.log('\n💡 The ICO file now contains multiple sizes for better Windows compatibility.');
    console.log('   You can now rebuild the app: npm run build');
  })
  .catch(error => {
    console.error('❌ Error generating ICO:', error.message);
    console.error('   Full error:', error);
    console.error('\n💡 Alternative: Use an online converter like https://convertio.co/png-ico/');
    console.error('   Make sure to select multiple sizes: 16, 32, 48, 64, 128, 256');
    process.exit(1);
  });
