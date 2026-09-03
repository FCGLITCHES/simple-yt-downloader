import {copyFile, mkdir, access} from 'node:fs/promises';
import {resolve} from 'node:path';

const here = process.cwd();
const repoRoot = resolve(here, '..');
const out = resolve(here, 'public');

const files = [
  ['public/Pic1.png', 'Pic1.png'],
  ['public/Pic2.png', 'Pic2.png'],
  ['public/Pic3.png', 'Pic3.png'],
  ['public/Pic4.png', 'Pic4.png'],
  ['assets/Logo.png', 'Logo.png'],
  ['public/fonts/manrope-latin.woff2', 'manrope-latin.woff2'],
];

await mkdir(out, {recursive: true});

for (const [sourceRelative, targetName] of files) {
  const source = resolve(repoRoot, sourceRelative);
  const target = resolve(out, targetName);
  try {
    await access(source);
  } catch {
    throw new Error(`Missing source asset: ${sourceRelative}. Remotion 9 intentionally refuses to fabricate or download replacements.`);
  }
  await copyFile(source, target);
  console.log(`source -> remotion: ${sourceRelative} -> public/${targetName}`);
}

console.log('Source asset sync complete. Every screenshot/logo/font used by the composition now comes from GetVideosLocally itself.');
