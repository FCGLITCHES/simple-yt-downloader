const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');

const zip = new AdmZip();
const productName = 'GetVideosLocally';
const buildFolder = path.join(__dirname, 'dist', `${productName}-win32-x64`);
const zipFileName = `${productName}-Portable.zip`;

if (!fs.existsSync(buildFolder)) {
    console.error(`❌ Build folder not found: ${buildFolder}`);
    process.exit(1);
}

console.log(`📦 Zipping build folder: ${buildFolder}...`);

try {
    zip.addLocalFolder(buildFolder);
    zip.writeZip(zipFileName);
    console.log(`✅ Successfully created ${zipFileName}`);
} catch (error) {
    console.error(`❌ Failed to create zip: ${error.message}`);
    process.exit(1);
}
