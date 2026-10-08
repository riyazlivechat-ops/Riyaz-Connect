// Turns a camera photo into a small, branded keepsake JPEG (as a data: URL) ready to upload.
window.RCPhoto = (() => {
  const MAX_SIDE = 1440;

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that photo.')); };
      img.src = url;
    });
  }

  // caption: { title, subtitle } drawn on a strip under the photo. Pass null for a plain photo.
  async function compose(file, caption) {
    const img = await loadImage(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const strip = caption ? Math.round(Math.max(w, h) * 0.085) : 0;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h + strip;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    if (caption) {
      ctx.fillStyle = '#0b5d45';
      ctx.fillRect(0, h, w, strip);
      ctx.fillStyle = '#e0b45c';
      ctx.fillRect(0, h, w, Math.max(2, Math.round(strip * 0.05)));
      const pad = Math.round(strip * 0.35);
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${Math.round(strip * 0.34)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.fillText(caption.title, pad, h + strip * 0.4, w - pad * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = `500 ${Math.round(strip * 0.22)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.fillText(caption.subtitle, pad, h + strip * 0.74, w - pad * 2);
    }
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  return { compose };
})();
