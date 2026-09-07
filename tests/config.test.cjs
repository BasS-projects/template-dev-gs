const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function runtime({document = null, script = {}, direct = {}, spreadsheet = null} = {}) {
  const context = vm.createContext({
    PropertiesService: {
      getDocumentProperties: () => document === null ? null : {getProperties: () => document},
      getScriptProperties: () => ({getProperties: () => script})
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      openById: id => { assert.equal(id, 'sheet-id'); return spreadsheet; }
    },
    console: {log() {}}
  });
  for (const file of ['Config.gs', 'Main.gs']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  context.direct = direct;
  vm.runInContext('Object.assign(APP_CONFIG, direct)', context);
  return context;
}

test('config chooses document then script then direct values independently per key', () => {
  const context = runtime({
    document: {APP_NAME: 'Document', SHEET_NAME: '  ', API_KEY: 'PUT_API_KEY_HERE'},
    script: {APP_NAME: 'Script', SHEET_NAME: 'Data', API_KEY: 'test-key'},
    direct: {APP_NAME: 'Direct', SHEET_NAME: 'Default', API_BASE_URL: 'https://example.invalid'}
  });
  assert.deepEqual(JSON.parse(JSON.stringify(context.getConfig())), {
    APP_NAME: 'Document', SHEET_NAME: 'Data', API_KEY: 'test-key',
    API_BASE_URL: 'https://example.invalid', SPREADSHEET_ID: ''
  });
});

test('standalone config falls back to script/direct and never returns template placeholders', () => {
  const context = runtime({script: {SPREADSHEET_ID: 'sheet-id'}, direct: {APP_NAME: 'Direct'}});
  const config = context.getConfig();
  assert.equal(config.SPREADSHEET_ID, 'sheet-id');
  assert.equal(config.APP_NAME, 'Direct');
  assert.equal(config.API_KEY, '');
  assert.equal(config.SHEET_NAME, '');
});

test('starter works on bound spreadsheet with unconfigured placeholders', () => {
  const context = runtime({spreadsheet: {getSheets: () => [{getName: () => 'First'}]}});
  assert.doesNotThrow(() => context.main());
});

test('starter resolves configured spreadsheet and named tab', () => {
  const context = runtime({
    script: {SPREADSHEET_ID: 'sheet-id', SHEET_NAME: 'Data'},
    spreadsheet: {getSheetByName: name => {assert.equal(name, 'Data'); return {getName: () => name};}}
  });
  assert.doesNotThrow(() => context.main());
});

test('starter explains missing spreadsheet or named tab instead of creating data', () => {
  assert.throws(() => runtime().main(), /Set SPREADSHEET_ID/);
  assert.throws(() => runtime({
    script: {SHEET_NAME: 'Missing'}, spreadsheet: {getSheetByName: () => null}
  }).main(), /Target sheet not found/);
});
