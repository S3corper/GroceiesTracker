(() => {
  if (window !== window.top || window.__groceryAndroidBridge || !window.GroceryNative) return;
  if (location.origin !== 'https://s3corper.github.io' ||
      !(location.pathname === '/GroceiesTracker' || location.pathname.startsWith('/GroceiesTracker/'))) return;
  window.__groceryAndroidBridge = true;
  const blobs = new Map();
  const createURL = URL.createObjectURL.bind(URL);
  const revokeURL = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = blob => { const url = createURL(blob); blobs.set(url, blob); return url; };
  URL.revokeObjectURL = url => { blobs.delete(url); revokeURL(url); };

  // Serial requests keep each native acknowledgement paired with its request.
  let queue = Promise.resolve();
  function send(message) {
    const task = queue.then(() => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Android did not respond. Please reopen the app and try again.')), 300000);
      GroceryNative.onmessage = event => {
        clearTimeout(timeout);
        if (event.data === 'ok' || event.data === 'cancelled') resolve(event.data);
        else reject(new Error(String(event.data).replace(/^error:/, '')));
      };
      GroceryNative.postMessage(JSON.stringify(message));
    }));
    queue = task.catch(() => {});
    return task;
  }
  let exporting = false;
  async function saveBlob(blob, name) {
    if (exporting) { alert('Finish saving the current backup first.'); return; }
    exporting = true;
    try {
      await send({ type: 'begin', size: blob.size, name: name || 'grocery-backup.json' });
      // Read bounded chunks, including receipt photos, without one huge base64 message.
      for (let offset = 0; offset < blob.size; offset += 49152) {
        const bytes = new Uint8Array(await blob.slice(offset, offset + 49152).arrayBuffer());
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        await send({ type: 'chunk', data: btoa(binary) });
      }
      await send({ type: 'finish' });
    } catch (error) {
      await send({ type: 'abort' }).catch(() => {});
      alert('Backup was not saved: ' + error.message);
    } finally { exporting = false; }
  }
  function handleDownload(anchor) {
    const blob = blobs.get(anchor.href);
    if (!blob || !anchor.download) return false;
    // Capture the Blob itself before the website immediately revokes its URL.
    void saveBlob(blob, anchor.download);
    return true;
  }
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!handleDownload(this)) originalClick.call(this);
  };
  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[download]');
    if (anchor && handleDownload(anchor)) event.preventDefault();
  }, true);
  if (navigator.clipboard) {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: text => send({ type: 'clipboard', text: String(text) }).then(() => undefined),
    });
  }
})();
