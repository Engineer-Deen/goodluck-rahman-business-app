const { cp, mkdir, readdir, rm } = require('fs/promises');
const { spawn } = require('child_process');
const path = require('path');

const root = process.cwd();
const tempBuild = path.join(root, 'temp_build');
const outDir = path.join(root, 'package-output', 'portable');

async function cleanOutDir() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
}

const excludedNames = new Set([
  'dist',
  'package-output',
  'release',
  'release2',
  'release3',
  'release4',
  'release5',
  'release6',
  'release7',
  'temp_build',
  'scripts',
  '.git',
  '.idea',
]);

async function copyRoot() {
  await rm(tempBuild, { recursive: true, force: true });
  await mkdir(tempBuild, { recursive: true });

  const items = await readdir(root, { withFileTypes: true });
  for (const item of items) {
    if (excludedNames.has(item.name)) {
      continue;
    }

    const src = path.join(root, item.name);
    const dest = path.join(tempBuild, item.name);
    await cp(src, dest, { recursive: true, force: true });
  }
}

function runPackager() {
  return new Promise((resolve, reject) => {
    const cliPath = path.join(root, 'node_modules', 'electron-packager', 'bin', 'electron-packager.js');
    const args = [
      cliPath,
      '.',
      'Good Luck Rahman Enterprise',
      '--platform=win32',
      '--arch=x64',
      `--out=${outDir}`,
      '--overwrite',
      '--electron-version=30.0.0',
    ];

    const proc = spawn(process.execPath, args, {
      cwd: tempBuild,
      stdio: 'inherit',
      shell: false,
    });

    proc.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`electron-packager exited with code ${code}`));
      }
    });
  });
}

(async () => {
  try {
    await cleanOutDir();
    await copyRoot();
    await runPackager();
    console.log('Package created successfully in', outDir);
  } catch (error) {
    console.error(error);
    process.exit(1);
  } finally {
    await rm(tempBuild, { recursive: true, force: true });
  }
})();
