/**
 * Build script for portable version
 * Uses a clean staging folder approach to avoid devDependency bloat
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const projectDir = __dirname;
const stagingDir = path.join(projectDir, '.build-staging');
const distDir = path.join(projectDir, 'dist');
const productName = 'GetVideosLocally';

// Files/folders to copy to staging (production app files only)
const filesToCopy = [
    'package.json',
    'package-lock.json',
    'electron-main.js',
    'server.js',
    'script.js',
    'index.html',
    'style.css',
    'preload.js',
];



// Folders to copy (app code only, not resources - those go via extra-resource)
const foldersToCopy = [
    'backend',
    'public',
];

// Folders to copy as extra-resources (handled by electron-packager)
const extraResources = [
    'bin',
    'assets',
    'public',
];

function copyFileSync(src, dest) {
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(src, dest);
}

function copyFolderSync(src, dest) {
    if (!fs.existsSync(src)) return;

    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyFolderSync(srcPath, destPath);
        } else {
            copyFileSync(srcPath, destPath);
        }
    }
}

function deleteFolderSync(folderPath) {
    if (fs.existsSync(folderPath)) {
        fs.rmSync(folderPath, { recursive: true, force: true });
    }
}

console.log(`🔧 Building ${productName} Portable...\n`);

try {
    // Step 1: Clean and create staging directory
    console.log('📦 Step 1: Creating clean staging folder...');
    deleteFolderSync(stagingDir);
    fs.mkdirSync(stagingDir, { recursive: true });
    console.log(`   Created: ${stagingDir}\n`);

    // Step 2: Copy production files to staging
    console.log('📦 Step 2: Copying production files...');

    for (const file of filesToCopy) {
        const srcPath = path.join(projectDir, file);
        const destPath = path.join(stagingDir, file);
        if (fs.existsSync(srcPath)) {
            copyFileSync(srcPath, destPath);
            console.log(`   ✓ ${file}`);
        }
    }

    for (const folder of foldersToCopy) {
        const srcPath = path.join(projectDir, folder);
        const destPath = path.join(stagingDir, folder);
        if (fs.existsSync(srcPath)) {
            copyFolderSync(srcPath, destPath);
            console.log(`   ✓ ${folder}/`);
        }
    }
    console.log('');

    // Step 3: Install production dependencies only
    console.log('📦 Step 3: Installing production dependencies...');
    execSync('npm ci --omit=dev', {
        cwd: stagingDir,
        stdio: 'inherit'
    });
    console.log('✅ Dependencies installed\n');

    // Step 4: Run electron-packager from staging directory
    console.log('📦 Step 4: Packaging with electron-packager...');

    // Build extra-resource flags
    const extraResourceFlags = extraResources
        .filter(res => fs.existsSync(path.join(projectDir, res)))
        .map(res => `--extra-resource="${path.join(projectDir, res)}"`)
        .join(' ');

    // Get electron version from package.json
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
    const electronVersion = pkg.devDependencies.electron.replace('^', '').replace('~', '');

    const iconPath = path.join(projectDir, 'public', 'Logo_1');
    const packagerCmd = [
        'npx -y electron-packager',
        '".build-staging"',
        `"${productName}"`,
        '--platform=win32',
        '--arch=x64',
        `--out="${distDir}"`,
        `--electron-version=${electronVersion}`,
        '--overwrite',
        '--asar',
        '--asarUnpack="node_modules/auto-launch/**"',
        '--asarUnpack="node_modules/winreg/**"',
        '--asarUnpack="node_modules/untildify/**"',
        `--icon="${iconPath}"`,
        extraResourceFlags,
    ].join(' ');

    console.log(`   Running: ${packagerCmd}`);

    execSync(packagerCmd, {
        cwd: projectDir,
        stdio: 'inherit',
        shell: true
    });
    console.log('✅ Packaging complete\n');

    // Step 5: Set icon
    console.log('🔧 Step 5: Setting icon...');
    execSync('node set-icon.js', {
        cwd: projectDir,
        stdio: 'inherit'
    });
    console.log('');

    // Step 6: Create zip
    console.log('📦 Step 6: Creating zip...');
    execSync('node zip-build.js', {
        cwd: projectDir,
        stdio: 'inherit'
    });
    console.log('');

    // Step 7: Clean up staging
    console.log('🧹 Step 7: Cleaning up staging folder...');
    deleteFolderSync(stagingDir);
    console.log('✅ Staging folder removed\n');

    console.log('🎉 Build complete!');
    console.log(`   Output: ${path.join(distDir, `${productName}-win32-x64`)}`);

} catch (error) {
    console.error('\n❌ Build failed:');
    console.error(error);

    // Keep staging on failure for debugging
    console.log('\n⚠️  Staging folder kept at: ' + stagingDir);

    process.exit(1);
}
