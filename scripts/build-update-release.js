const { mkdir, readdir, stat } = require('fs/promises');
const { spawn } = require('child_process');
const path = require('path');

const root = process.cwd();
const outputRoot = path.join(root, 'package-output', 'update-release');
const outputDir = path.join(outputRoot, `build-${Date.now()}`);

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: false,
    });
    proc.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function listFilesRecursive(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

async function assertArtifacts() {
  const files = await listFilesRecursive(outputDir);
  const setupExe = files.find((f) => /Setup .*\.exe$/i.test(path.basename(f)));
  const blockmap = files.find((f) => /\.exe\.blockmap$/i.test(path.basename(f)));
  const latestYml = files.find((f) => /^latest\.yml$/i.test(path.basename(f)));

  if (!setupExe) throw new Error('Missing setup installer (.exe).');
  if (!blockmap) throw new Error('Missing installer blockmap (.exe.blockmap).');
  if (!latestYml) throw new Error('Missing latest.yml for auto-update.');

  console.log('\nRelease artifacts ready:');
  console.log(`- Installer: ${setupExe}`);
  console.log(`- Blockmap:  ${blockmap}`);
  console.log(`- latest.yml: ${latestYml}`);
  console.log('\nUpload these files (and any referenced package files) to your update server URL.');
}

async function main() {
  await mkdir(outputRoot, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  const builderCli = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
  const args = [
    builderCli,
    '--win',
    'nsis',
    '--x64',
    '--publish',
    'never',
    '--config.publish.provider=generic',
    '--config.publish.url=https://goodluckrahmanenterprise.netlify.app/',
    `--config.directories.output=${outputDir}`,
  ];

  await runCommand(process.execPath, args, root);

  const info = await stat(outputDir);
  if (!info.isDirectory()) {
    throw new Error('Output directory was not created.');
  }
  await assertArtifacts();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

