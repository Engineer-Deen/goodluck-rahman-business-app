const { mkdir, readdir, stat } = require('fs/promises');
const { spawn } = require('child_process');
const path = require('path');

const root = process.cwd();
const outputRoot = path.join(root, 'package-output', 'update-release');

function parsePlatformArg() {
  const arg = process.argv.find((a) => a.startsWith('--platform='));
  const platform = arg ? arg.split('=')[1].trim().toLowerCase() : 'win';
  if (!['win', 'mac', 'all'].includes(platform)) {
    throw new Error('Invalid platform. Use --platform=win|mac|all');
  }
  return platform;
}

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

function assertWindowsArtifacts(files) {
  const setupExe = files.find((f) => /Setup .*\.exe$/i.test(path.basename(f)));
  const blockmap = files.find((f) => /\.exe\.blockmap$/i.test(path.basename(f)));
  const latestYml = files.find((f) => /^latest\.yml$/i.test(path.basename(f)));

  if (!setupExe) throw new Error('Missing setup installer (.exe).');
  if (!blockmap) throw new Error('Missing installer blockmap (.exe.blockmap).');
  if (!latestYml) throw new Error('Missing latest.yml for auto-update.');

  console.log('\nWindows release artifacts ready:');
  console.log(`- Installer: ${setupExe}`);
  console.log(`- Blockmap:  ${blockmap}`);
  console.log(`- latest.yml: ${latestYml}`);
}

function assertMacArtifacts(files) {
  const archive = files.find((f) => /\.(dmg|zip)$/i.test(path.basename(f)));
  const latestMacYml = files.find((f) => /^latest(-mac)?\.yml$/i.test(path.basename(f)));

  if (!archive) throw new Error('Missing macOS artifact (.dmg or .zip).');
  if (!latestMacYml) throw new Error('Missing latest-mac.yml or latest.yml for auto-update.');

  console.log('\nmacOS release artifacts ready:');
  console.log(`- Archive: ${archive}`);
  console.log(`- latest-mac.yml: ${latestMacYml}`);
}

async function buildRelease(platform) {
  if (platform === 'mac' && process.platform !== 'darwin') {
    throw new Error('macOS release build requires a Mac environment. Run this command on macOS.');
  }

  const outputDir = path.join(outputRoot, platform, `build-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });

  const builderCli = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
  const args = [builderCli];

  if (platform === 'win') {
    args.push('--win', 'nsis', '--x64');
  } else if (platform === 'mac') {
    args.push('--mac');
  }

  args.push('--publish', 'never', `--config.directories.output=${outputDir}`);

  await runCommand(process.execPath, args, root);
  const info = await stat(outputDir);
  if (!info.isDirectory()) {
    throw new Error('Output directory was not created.');
  }

  const files = await listFilesRecursive(outputDir);
  if (platform === 'win') {
    assertWindowsArtifacts(files);
  } else {
    assertMacArtifacts(files);
  }

  console.log(`\nBuild complete for ${platform}: ${outputDir}`);
}

async function main() {
  const platformArg = parsePlatformArg();
  const platforms = platformArg === 'all' ? ['win', 'mac'] : [platformArg];

  for (const platform of platforms) {
    await buildRelease(platform);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

