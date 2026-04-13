// generate-icon.js - Generate a multi-size ICO file from PNG using sharp
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const toIco = require('to-ico');

const pngPath = path.resolve(__dirname, 'public', 'Logo_1.png');
const icoPath = path.resolve(__dirname, 'public', 'Logo_1.ico');

console.log('🎨 Generating multi-size ICO file...\n');
console.log('   Source PNG:', pngPath);
console.log('   Output ICO:', icoPath);

if (!fs.existsSync(pngPath)) {
  console.error('❌ PNG file not found:', pngPath);
  process.exit(1);
}

// Sizes for ICO file (Windows compatible sizes)
const sizes = [16, 32, 48, 64, 128, 256];

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
  )
)
  .then(buffers => {
    console.log('   ✓ Generated', buffers.length, 'sized versions');
    console.log('   Creating ICO file...\n');
    
    // Convert buffers to ICO
    // Note: to-ico may have issues with large sizes, so we'll use only standard sizes
    return toIco(buffers.slice(0, 5)); // Use first 5 sizes (up to 128)
  })
  .then(icoBuffer => {
    // Write ICO file
    fs.writeFileSync(icoPath, icoBuffer);
    
    const stats = fs.statSync(icoPath);
    console.log('✅ ICO file generated successfully!');
    console.log('   Output size:', stats.size, 'bytes');
    console.log('   Location:', icoPath);
    console.log('   Contains sizes: 16, 32, 48, 64, 128');
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
