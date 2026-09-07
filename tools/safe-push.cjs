#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {pathToFileURL} = require('node:url');

function ensure(condition, message) { if (!condition) throw new Error(message); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

/** Compare API identity/type/source only, never timestamps or local filesystem paths. */
function contentHash(files) {
  ensure(Array.isArray(files), 'Invalid project file list');
  const seen = new Set();
  const canonical = files.map(file => {
    ensure(typeof file.remotePath === 'string' && typeof file.source === 'string', 'Incomplete project file');
    ensure(['SERVER_JS', 'HTML', 'JSON'].includes(file.type), 'Unsupported project file type');
    ensure(!seen.has(file.remotePath), 'Duplicate remote file name'); seen.add(file.remotePath);
    let source = file.source.replace(/\r\n/g, '\n');
    if (file.type === 'JSON') source = JSON.stringify(stable(JSON.parse(source.replace(/^\uFEFF/, ''))));
    return {name: file.remotePath, type: file.type, source};
  }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** Side effects are injected so the full sequence can be tested without Google. */
async function runSafePush(api, {localFiles, sha, dryRun = false, log = console.log, checkLocal = async () => {}}) {
  const expected = contentHash(localFiles);
  ensure(localFiles.some(f => f.remotePath === 'appsscript' && f.type === 'JSON'), 'Local manifest missing; refusing push');
  let stage = 'read remote HEAD'; let pushStarted = false; let backupVersion;
  try {
    const head = await api.pull('remote-head');
    const headHash = contentHash(head);
    stage = 'list versions';
    const versions = await api.listVersions();
    ensure(Array.isArray(versions) && versions.every(v => Number.isSafeInteger(v.versionNumber) && v.versionNumber > 0), 'Invalid version list');
    const latest = versions.length ? Math.max(...versions.map(v => v.versionNumber)) : null;
    stage = 'read latest version';
    const latestHash = latest === null ? null : contentHash(await api.pull('latest-version', latest));
    const needsBackup = latestHash !== headHash;
    log(`Latest Version: ${latest === null ? 'none' : latest}; Remote HEAD: ${needsBackup ? 'requires backup' : 'matches latest version'}`);
    // Apps Script currently permits at most 200 versions. Never delete one automatically.
    ensure(versions.length + (needsBackup ? 2 : 1) <= 200, 'Not enough version slots for backup and post-push snapshot; no push performed');
    if (dryRun) return {status: 'dry-run', latestVersion: latest, needsBackup, localHash: expected, remoteHash: headHash};
    await checkLocal();
    if (needsBackup) {
      stage = 'backup remote';
      backupVersion = await api.createVersion('backup remote before local push');
      ensure(Number.isSafeInteger(backupVersion) && backupVersion > 0, 'Invalid backup version number');
      ensure(contentHash(await api.pull('backup-version', backupVersion)) === headHash, 'Remote changed during backup; push stopped');
      log(`Backup Version: ${backupVersion}`);
    }
    stage = 'recheck remote HEAD';
    ensure(contentHash(await api.pull('before-push')) === headHash, 'Remote changed since comparison; push stopped');
    await checkLocal();
    stage = 'push local'; pushStarted = true;
    await api.push();
    stage = 'verify pushed HEAD';
    ensure(contentHash(await api.pull('after-push')) === expected, 'Remote HEAD does not match local upload; no local version created');
    stage = 'snapshot local push';
    const version = await api.createVersion('local push ' + sha);
    ensure(Number.isSafeInteger(version) && version > 0, 'Invalid local version number');
    stage = 'verify local version';
    ensure(contentHash(await api.pull('local-version', version)) === expected, 'Created version differs from local upload; concurrent remote edit detected');
    log(`Local Version: ${version} (local push ${sha})`);
    return {status: 'success', backupVersion, version, sha};
  } catch (error) {
    // No automatic write retry/rollback: a timed-out request may already have succeeded.
    throw new Error(`Safe push stopped at '${stage}'. ${pushStarted ? 'Remote may already contain the upload; inspect HEAD/Versions before retrying.' : 'Local upload was not started.'}${backupVersion ? ' Backup Version: ' + backupVersion + '.' : ''} ${error.message}`);
  }
}

function git(root, args) { return execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim(); }
function cleanRevision(root) {
  ensure(!git(root, ['status', '--porcelain', '--untracked-files=all']), 'Commit or move local changes before safe push (Git must describe the upload)');
  return git(root, ['rev-parse', 'HEAD']);
}
function inside(parent, target) {
  const relative = path.relative(parent, target);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

async function removeOwnedTemp(directory, tempParent) {
  const resolved = await fs.realpath(directory);
  ensure(path.dirname(resolved) === tempParent && path.basename(resolved).startsWith('clasp-safe-push-'), 'Refusing cleanup outside owned temp directory');
  ensure(!(await fs.lstat(directory)).isSymbolicLink(), 'Refusing symlink temp cleanup');
  await fs.rm(resolved, {recursive: true, force: true});
}

async function loadClasp() {
  const entry = require.resolve('@google/clasp');
  const base = path.dirname(entry);
  const pkg = JSON.parse(await fs.readFile(path.resolve(base, '../../package.json'), 'utf8'));
  ensure(pkg.version === '3.4.1', 'Safe push adapter requires clasp 3.4.1; review adapter before upgrading');
  const [auth, core] = await Promise.all([
    import(pathToFileURL(path.join(base, 'auth/auth.js')).href),
    import(pathToFileURL(path.join(base, 'core/clasp.js')).href)
  ]);
  return {initAuth: auth.initAuth, initClaspInstance: core.initClaspInstance};
}

async function main(args = process.argv.slice(2)) {
  let project = '.clasp.json'; let dryRun = false; let localCheck = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project' && args[i + 1]) project = args[++i];
    else if (args[i] === '--dry-run') dryRun = true;
    else if (args[i] === '--local-check') localCheck = true;
    else throw new Error('Usage: safe-push.cjs [--project .clasp.json] [--dry-run | --local-check]');
  }
  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  const revision = localCheck ? git(root, ['rev-parse', 'HEAD']) : cleanRevision(root);
  const configPath = path.resolve(root, project);
  ensure(inside(root, configPath), 'Project config must be inside this repository');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  ensure(typeof config.scriptId === 'string' && config.scriptId && !config.scriptId.includes('PUT_SCRIPT_ID'), 'Set scriptId in the selected clasp config');
  ensure(!config.allowSymlinks, 'Safe push does not support symlink source files');
  const sourceDir = await fs.realpath(path.resolve(path.dirname(configPath), config.srcDir || config.rootDir || '.'));
  ensure(sourceDir === await fs.realpath(root) || inside(await fs.realpath(root), sourceDir), 'Source directory must be inside repository');
  const {initAuth, initClaspInstance} = await loadClasp();
  // --local-check deliberately does not load credentials or contact Google.
  const credentials = localCheck ? undefined : (await initAuth({userKey: 'default', authFilePath: process.env.clasp_config_auth})).credentials;
  ensure(localCheck || credentials, 'Run npm run login before safe push');
  const original = await initClaspInstance({configFile: configPath, credentials});
  const collected = await original.files.collectLocalFiles();
  ensure(collected.skipped.length === 0, 'clasp skipped local files; resolve them before pushing');
  ensure(collected.files.length > 0, 'No source files selected');
  if (!localCheck) for (const file of collected.files) {
    git(root, ['ls-files', '--error-unmatch', '--', path.relative(root, path.resolve(file.localPath))]);
  }
  const expected = contentHash(collected.files);
  if (localCheck) {
    console.log(JSON.stringify({status: 'local-check', scriptId: config.scriptId, files: collected.files.length, hash: expected}));
    return;
  }
  const checkLocal = async () => {
    ensure(cleanRevision(root) === revision, 'Git revision changed during safe push');
    const now = await original.files.collectLocalFiles();
    ensure(now.skipped.length === 0 && contentHash(now.files) === expected, 'Local upload changed during safe push');
  };
  const commonGitDir = path.resolve(root, git(root, ['rev-parse', '--git-common-dir']));
  const lockPath = path.join(commonGitDir, 'clasp-safe-push-' + crypto.createHash('sha256').update(config.scriptId).digest('hex').slice(0, 16) + '.lock');
  const lock = await fs.open(lockPath, 'wx').catch(() => { throw new Error('Another safe push may be running. Inspect the clasp-safe-push lock in the Git common directory before removing a stale lock.'); });
  let temp;
  const tempParent = await fs.realpath(os.tmpdir());
  try {
    await lock.writeFile(JSON.stringify({pid: process.pid, scriptId: config.scriptId, started: new Date().toISOString()}));
    temp = await fs.mkdtemp(path.join(tempParent, 'clasp-safe-push-'));
    async function workspace(label) {
      const directory = path.join(temp, label);
      await fs.mkdir(directory);
      const stagedConfig = {...config, rootDir: '.', srcDir: '.', allowSymlinks: false};
      // filePushOrder paths are interpreted relative to process.cwd() by clasp core.
      stagedConfig.filePushOrder = (config.filePushOrder || []).map(name => {
        const source = path.resolve(root, name);
        ensure(inside(sourceDir, source), 'filePushOrder entry is outside source directory');
        return path.relative(process.cwd(), path.join(directory, path.relative(sourceDir, source)));
      });
      await fs.writeFile(path.join(directory, '.clasp.json'), JSON.stringify(stagedConfig));
      await fs.writeFile(path.join(directory, '.claspignore'), '**/.clasp.json\n**/.claspignore\n');
      const clasp = await initClaspInstance({configFile: path.join(directory, '.clasp.json'), ignoreFile: path.join(directory, '.claspignore'), credentials});
      return {directory, clasp};
    }
    const upload = await workspace('local-upload');
    for (const file of collected.files) {
      const relative = path.relative(sourceDir, path.resolve(file.localPath));
      const target = path.resolve(upload.directory, relative);
      ensure(inside(upload.directory, target), 'Local file escaped staging directory');
      await fs.mkdir(path.dirname(target), {recursive: true});
      await fs.writeFile(target, file.source);
    }
    const staged = await upload.clasp.files.collectLocalFiles();
    ensure(staged.skipped.length === 0 && contentHash(staged.files) === expected, 'Staged upload differs from local source');
    const api = {
      async pull(label, version) {
        const target = await workspace(label);
        const pulled = await target.clasp.files.pull(version);
        ensure(pulled.writeResult.skipped.length === 0, 'Remote files could not be safely written to temp');
        return pulled.files;
      },
      async listVersions() {
        const result = await upload.clasp.project.listVersions();
        ensure(!result.partialResults, 'Version listing was incomplete; refusing push');
        return result.results;
      },
      createVersion: description => upload.clasp.project.version(description),
      async push() {
        const result = await upload.clasp.files.push();
        ensure(result.skipped.length === 0 && contentHash(result.files) === expected, 'Push did not upload the complete staged file set');
      }
    };
    const result = await runSafePush(api, {localFiles: staged.files, sha: revision.slice(0, 7), dryRun, checkLocal});
    console.log(JSON.stringify(result));
  } finally {
    try { if (temp) await removeOwnedTemp(temp, tempParent); }
    finally { await lock.close(); await fs.unlink(lockPath); }
  }
}

if (require.main === module) main().catch(error => {
  // Avoid printing API request objects, source code, OAuth credentials or stack causes.
  console.error(error.message); process.exitCode = 1;
});
module.exports = {contentHash, runSafePush, removeOwnedTemp, main, loadClasp};
