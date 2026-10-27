import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('app/src/main/assets/android-bridge.js', import.meta.url), 'utf8');
function harness(path = '/GroceiesTracker/', origin = 'https://s3corper.github.io') {
  const messages = [], alerts = [];
  let clicks = 0;
  class Anchor { click() { clicks++; } }
  const bridge = { postMessage(raw) {
    messages.push(JSON.parse(raw));
    queueMicrotask(() => bridge.onmessage({ data: 'ok' }));
  } };
  const context = vm.createContext({
    location: { pathname: path, origin },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} },
    HTMLAnchorElement: Anchor, Uint8Array, Blob, Map, Promise,
    navigator: { clipboard: {} }, GroceryNative: bridge,
    document: { addEventListener() {} },
    alert: value => alerts.push(value),
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    setTimeout, clearTimeout,
  });
  context.window = context;
  context.top = context;
  vm.runInContext(source, context);
  return { context, messages, alerts, Anchor, clicks: () => clicks };
}
async function settledUntil(condition) {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(condition(), 'bridge must finish');
}
test('exports large UTF-8 backups intact even when URL is immediately revoked', async () => {
  const h = harness();
  const body = JSON.stringify({ receipts: ['蔬菜🥕'.repeat(30000)] });
  const blob = new Blob([body], { type: 'application/json' });
  const a = new h.Anchor();
  a.href = h.context.URL.createObjectURL(blob);
  a.download = 'groceries-backup.json';
  a.click();
  h.context.URL.revokeObjectURL(a.href);
  await settledUntil(() => h.messages.some(m => m.type === 'finish'));
  const chunks = h.messages.filter(m => m.type === 'chunk').map(m => Buffer.from(m.data, 'base64'));
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(c => c.length <= 49152));
  assert.equal(Buffer.concat(chunks).toString('utf8'), body);
  assert.equal(h.messages[0].size, Buffer.byteLength(body));
  assert.equal(h.clicks(), 0);
  assert.deepEqual(h.alerts, []);
});
test('regular links still work and clipboard writes use the native channel', async () => {
  const h = harness();
  const a = new h.Anchor(); a.href = 'https://example.com'; a.click();
  assert.equal(h.clicks(), 1);
  await h.context.navigator.clipboard.writeText('https://s3corper.github.io/GroceiesTracker/?invite=test');
  assert.equal(h.messages[0].type, 'clipboard');
});
test('does not expose bridge outside the app path or origin', () => {
  for (const h of [harness('/another-repo/'), harness('/GroceiesTracker/', 'https://evil.test')]) {
    assert.equal(h.context.__groceryAndroidBridge, undefined);
    assert.equal(h.context.navigator.clipboard.writeText, undefined);
  }
});
test('initialization is idempotent', () => {
  const h = harness();
  const click = h.Anchor.prototype.click;
  vm.runInContext(source, h.context);
  assert.equal(h.Anchor.prototype.click, click);
});
