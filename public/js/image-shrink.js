// Shrinks a picture in the browser before it is uploaded.
//
// The server has no image library and is not getting one: a native
// dependency to compile on every Node upgrade is a poor trade for
// resizing a portrait. Doing it here is better anyway -- the 5MB original
// never crosses the network, and the server does no image work at all.
//
// Everything degrades: with JavaScript off, or a format canvas will not
// re-encode, the file goes up untouched and the server's size limit is
// what catches it.
(function () {
  'use strict';
  const MAX_EDGE = 1400;
  // Under this, shrinking would cost more quality than it saves bytes.
  const LEAVE_ALONE_BYTES = 300 * 1024;

  function replaceFile(input, file) {
    const carrier = new DataTransfer();
    carrier.items.add(file);
    input.files = carrier.files;
  }

  async function shrink(input) {
    const file = input.files && input.files[0];
    if (!file || !/^image\//.test(file.type)) return;
    if (file.size <= LEAVE_ALONE_BYTES) return;
    // A GIF may be animated, and a canvas would flatten it to its first
    // frame -- which is not a smaller version of the picture, it is a
    // different picture.
    if (file.type === 'image/gif') return;

    let bitmap;
    try { bitmap = await createImageBitmap(file); } catch (e) { return; }
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= LEAVE_ALONE_BYTES * 4) { bitmap.close(); return; }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) { bitmap.close(); return; }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    // PNG keeps its transparency; anything else re-encodes as JPEG, which
    // is what a photograph wanted in the first place.
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
    // Only swap it in if the round trip actually helped.
    if (!blob || blob.size >= file.size) return;
    const name = file.name.replace(/\.[^.]+$/, '') + (type === 'image/png' ? '.png' : '.jpg');
    replaceFile(input, new File([blob], name, { type }));
  }

  document.addEventListener('change', (ev) => {
    const target = /** @type {HTMLInputElement} */ (ev.target);
    if (!target || target.tagName !== 'INPUT' || target.type !== 'file') return;
    if (!target.hasAttribute('data-shrink')) return;
    const form = target.form;
    // The form must not be submitted while the canvas is still working,
    // so the button is held until the swap is done.
    const buttons = form ? Array.from(form.querySelectorAll('button')) : [];
    for (const b of buttons) b.disabled = true;
    shrink(target).catch(() => {}).then(() => {
      for (const b of buttons) b.disabled = false;
    });
  });
}());
