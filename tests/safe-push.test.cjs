const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {contentHash, runSafePush, loadClasp, removeOwnedTemp} = require('../tools/safe-push.cjs');

const files = source => [
  {remotePath: 'appsscript', type: 'JSON', source: '{"timeZone":"Asia/Bangkok","runtimeVersion":"V8"}'},
  {remotePath: 'Main', type: 'SERVER_JS', source}
];
function harness({head = files('remote'), versions = [files('remote')]} = {}) {
  const events = []; const snapshots = new Map(versions.map((value, i) => [i + 1, value]));
  const state = {head, snapshots, events};
  const local = files('local');
  const api = {
    async pull(label, version) { events.push(label); return version ? snapshots.get(version) : state.head; },
    async listVersions() { events.push('versions'); return [...snapshots.keys()].reverse().map(versionNumber => ({versionNumber})); },
    async createVersion(description) { events.push(description); const version = snapshots.size + 1; snapshots.set(version, state.head); return version; },
    async push() { events.push('push'); state.head = local; }
  };
  return {state, api, options: {localFiles: local, sha: 'a84f92c', log() {}}};
}

test('hash ignores ordering, metadata and CRLF; includes names, types, deletions and code whitespace', () => {
  const a = files('function x() {\r\n  return 1;\r\n}');
  const b = files('function x() {\n  return 1;\n}');
  b[0].source = '{ "runtimeVersion": "V8", "timeZone": "Asia/Bangkok" }'; b[1].localPath = '/tmp/x.gs';
  assert.equal(contentHash(a), contentHash(b.reverse()));
  assert.notEqual(contentHash(a), contentHash(files('function x() { return 1; }')));
  assert.notEqual(contentHash(a), contentHash(a.slice(0, 1)));
  assert.throws(() => contentHash([...a, a[0]]), /Duplicate/);
});

test('same remote/version skips backup and snapshots verified local push', async () => {
  const {state, api, options} = harness();
  const result = await runSafePush(api, options);
  assert.equal(result.version, 2); assert.equal(result.backupVersion, undefined);
  assert.deepEqual(state.events, ['remote-head', 'versions', 'latest-version', 'before-push', 'push', 'after-push', 'local push a84f92c', 'local-version']);
});

test('different remote is backed up and verified before upload', async () => {
  const {state, api, options} = harness({versions: [files('older')]});
  const result = await runSafePush(api, options);
  assert.equal(result.backupVersion, 2); assert.equal(result.version, 3);
  assert.equal(contentHash(state.snapshots.get(2)), contentHash(files('remote')));
  assert.ok(state.events.indexOf('backup-version') < state.events.indexOf('push'));
});

test('no existing versions creates initial backup, even for empty remote', async () => {
  const {api, options} = harness({head: [], versions: []});
  const result = await runSafePush(api, options);
  assert.equal(result.backupVersion, 1); assert.equal(result.version, 2);
});

test('dry-run reads snapshots but never creates versions or pushes', async () => {
  const {state, api, options} = harness({versions: [files('older')]});
  const result = await runSafePush(api, {...options, dryRun: true});
  assert.equal(result.needsBackup, true);
  assert.deepEqual(state.events, ['remote-head', 'versions', 'latest-version']);
});

test('backup failure prevents upload', async () => {
  const {state, api, options} = harness({versions: []});
  api.createVersion = async () => {throw new Error('quota');};
  await assert.rejects(runSafePush(api, options), /Local upload was not started/);
  assert.ok(!state.events.includes('push'));
});

test('remote edit during comparison or backup aborts before push', async () => {
  for (const label of ['before-push', 'backup-version']) {
    const {state, api, options} = harness({versions: []}); const pull = api.pull;
    api.pull = async (name, version) => name === label ? files('concurrent edit') : pull(name, version);
    await assert.rejects(runSafePush(api, options), /Remote changed/);
    assert.ok(!state.events.includes('push'));
  }
});

test('changed local revision stops before remote mutations', async () => {
  const {state, api, options} = harness({versions: []});
  await assert.rejects(runSafePush(api, {...options, checkLocal: async () => {throw new Error('dirty');}}), /dirty/);
  assert.ok(!state.events.includes('backup remote before local push')); assert.ok(!state.events.includes('push'));
});

test('failed or silently skipped push does not create local snapshot', async () => {
  for (const failure of [false, true]) {
    const {state, api, options} = harness();
    api.push = async () => {if (failure) throw new Error('network');};
    await assert.rejects(runSafePush(api, options), /Remote may already contain/);
    assert.ok(!state.events.includes('local push a84f92c'));
  }
});

test('version failure after push reports partial completion without rollback/retry', async () => {
  const {state, api, options} = harness(); api.createVersion = async () => {throw new Error('version failed');};
  await assert.rejects(runSafePush(api, options), /snapshot local push/);
  assert.equal(contentHash(state.head), contentHash(options.localFiles));
  assert.equal(state.events.filter(e => e === 'push').length, 1);
});

test('concurrent edit during final snapshot is detected', async () => {
  const {api, options} = harness(); const pull = api.pull;
  api.pull = async (label, version) => label === 'local-version' ? files('changed') : pull(label, version);
  await assert.rejects(runSafePush(api, options), /concurrent remote edit/);
});

test('version capacity check reserves both backup and local snapshots', async () => {
  const {state, api, options} = harness({versions: Array.from({length: 199}, () => files('older'))});
  await assert.rejects(runSafePush(api, options), /Not enough version slots/);
  assert.ok(!state.events.includes('push'));
});

test('pinned clasp adapter collects a temp upload including nested HTML and manifest', async () => {
  const {initClaspInstance} = await loadClasp();
  const parent = await fs.realpath(os.tmpdir()); const dir = await fs.mkdtemp(path.join(parent, 'clasp-safe-push-test-'));
  try {
    await fs.mkdir(path.join(dir, 'views'));
    await fs.writeFile(path.join(dir, '.clasp.json'), JSON.stringify({scriptId: 'test', rootDir: '.', scriptExtensions: ['.gs']}));
    await fs.writeFile(path.join(dir, '.claspignore'), '**/.clasp.json\n**/.claspignore\n');
    await fs.writeFile(path.join(dir, 'appsscript.json'), '{}');
    await fs.writeFile(path.join(dir, 'Main.gs'), 'function run() {}');
    await fs.writeFile(path.join(dir, 'views', 'Index.html'), '<p>Test</p>');
    const clasp = await initClaspInstance({configFile: path.join(dir, '.clasp.json'), ignoreFile: path.join(dir, '.claspignore')});
    const result = await clasp.files.collectLocalFiles();
    assert.equal(result.skipped.length, 0);
    assert.deepEqual(result.files.map(f => f.remotePath).sort(), ['Main', 'appsscript', 'views/Index']);
    contentHash(result.files);
  } finally { await removeOwnedTemp(dir, parent); }
});

test('clasp core transport supports HEAD/version pulls and complete-set push including deletion', async () => {
  const {initClaspInstance} = await loadClasp();
  const parent = await fs.realpath(os.tmpdir()); const dir = await fs.mkdtemp(path.join(parent, 'clasp-safe-push-api-test-'));
  const requests = [];
  let remote = files('old').map(f => ({name: f.remotePath, type: f.type, source: f.source}));
  remote.push({name: 'Deleted', type: 'SERVER_JS', source: 'function old() {}'});
  const credentials = {async request(options) {
    requests.push(options);
    if (options.method === 'GET' && options.url.endsWith('/content')) return {data: {files: remote}};
    if (options.method === 'PUT' && options.url.endsWith('/content')) {remote = options.data.files; return {data: {files: remote}};}
    if (options.method === 'GET' && options.url.endsWith('/versions')) return {data: {versions: [{versionNumber: 1}]}};
    if (options.method === 'POST' && options.url.endsWith('/versions')) return {data: {versionNumber: 2}};
    throw new Error('Unexpected API request; network is disabled in this test');
  }};
  try {
    const configFile = path.join(dir, '.clasp.json'); const ignoreFile = path.join(dir, '.claspignore');
    await fs.writeFile(configFile, JSON.stringify({scriptId: 'test', rootDir: '.', scriptExtensions: ['.gs']}));
    await fs.writeFile(ignoreFile, '**/.clasp.json\n**/.claspignore\n');
    const clasp = await initClaspInstance({configFile, ignoreFile, credentials});
    const pulled = await clasp.files.pull(1);
    assert.equal(pulled.files.length, 3); assert.equal(pulled.writeResult.skipped.length, 0);
    assert.equal(Number(requests[0].params.versionNumber), 1);
    await fs.unlink(path.join(dir, 'Deleted.gs'));
    const pushed = await clasp.files.push();
    assert.equal(pushed.files.length, 2); assert.ok(!remote.some(f => f.name === 'Deleted'));
    const versions = await clasp.project.listVersions(); assert.equal(versions.partialResults, false);
    assert.equal(await clasp.project.version('local push abc1234'), 2);
    assert.equal(requests.at(-1).data.description, 'local push abc1234');
  } finally { await removeOwnedTemp(dir, parent); }
});
