// Recorte da foto do convidado, na hora do envio. Moldura única 4:3 (1200×900) para a plateia, o media kit, o portal do
// patrocinador e o painel: o que a pessoa enquadra aqui é exatamente o que aparece em todos esses lugares.
// Uso: window.pulsoCrop(file, { reopen }) -> Promise<Blob JPEG | null>. Quem chama (app.js) envia o Blob no lugar do arquivo.
(function () {
  const dlg = document.getElementById('modal-recorte');
  if (!dlg) return;
  const stage = dlg.querySelector('[data-crop-stage]');
  const view = dlg.querySelector('[data-crop-canvas]');
  const ctx = view.getContext('2d');
  const zoomEl = dlg.querySelector('[data-crop-zoom]');
  const warn = dlg.querySelector('[data-crop-warn]');
  const previews = [...dlg.querySelectorAll('[data-crop-preview]')];
  const OUT_W = Number(dlg.dataset.outW) || 1200;
  const OUT_H = Number(dlg.dataset.outH) || 900;
  const VW = view.width; const VH = view.height;
  const MAX_ZOOM = 4;
  const MIN_SOURCE_PX = 700; // largura de foto original que cabe na moldura; abaixo disso avisa que pode ficar borrado
  let img = null; let iw = 0; let ih = 0; let z = 1; let ox = 0; let oy = 0;
  let settle = null; let reopen = null; let decided = false;

  const base = () => Math.max(VW / iw, VH / ih); // "cobrir a moldura"
  const scale = () => base() * z;
  const clamp = () => { const sc = scale(); ox = Math.min(0, Math.max(VW - iw * sc, ox)); oy = Math.min(0, Math.max(VH - ih * sc, oy)); };

  function draw() {
    clamp();
    const sc = scale();
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, VW, VH);
    ctx.drawImage(img, ox, oy, iw * sc, ih * sc);
    previews.forEach((c) => { const p = c.getContext('2d'); p.imageSmoothingQuality = 'high'; p.drawImage(view, 0, 0, VW, VH, 0, 0, c.width, c.height); });
    warn.hidden = VW / sc >= MIN_SOURCE_PX;
  }

  // aproxima mantendo parado o ponto sob (cx, cy), em pixels do canvas
  function setZoom(next, cx = VW / 2, cy = VH / 2) {
    const nz = Math.min(MAX_ZOOM, Math.max(1, next));
    const before = scale();
    const px = (cx - ox) / before; const py = (cy - oy) / before;
    z = nz;
    const after = scale();
    ox = cx - px * after; oy = cy - py * after;
    zoomEl.value = String(nz);
    draw();
  }

  async function decode(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* tenta sem a opção */ }
      try { return await createImageBitmap(file); } catch { /* tenta pelo <img> */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const el = new Image(); el.src = url; await el.decode();
      return el;
    } finally { URL.revokeObjectURL(url); }
  }

  // arrastar (mouse e toque)
  let drag = null;
  const k = () => VW / stage.getBoundingClientRect().width;
  stage.addEventListener('pointerdown', (e) => {
    if (!img) return;
    drag = { x: e.clientX, y: e.clientY, ox, oy };
    try { stage.setPointerCapture(e.pointerId); } catch { /* sem ponteiro ativo (evento sintético): arrastar segue valendo */ }
  });
  stage.addEventListener('pointermove', (e) => { if (!drag || !img) return; ox = drag.ox + (e.clientX - drag.x) * k(); oy = drag.oy + (e.clientY - drag.y) * k(); draw(); });
  ['pointerup', 'pointercancel'].forEach((t) => stage.addEventListener(t, () => { drag = null; }));
  stage.addEventListener('wheel', (e) => {
    if (!img) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    setZoom(z * (e.deltaY < 0 ? 1.08 : 1 / 1.08), (e.clientX - r.left) * k(), (e.clientY - r.top) * k());
  }, { passive: false });
  stage.addEventListener('keydown', (e) => {
    if (!img) return;
    const step = 12; const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) { e.preventDefault(); ox += moves[e.key][0]; oy += moves[e.key][1]; draw(); } else if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(z * 1.1); } else if (e.key === '-') { e.preventDefault(); setZoom(z / 1.1); }
  });
  zoomEl.addEventListener('input', () => setZoom(Number(zoomEl.value)));

  function finish(blob) {
    if (decided) return;
    decided = true;
    if (dlg.open) dlg.close();
    if (img && img.close) img.close();
    img = null;
    const done = settle; settle = null;
    if (done) done(blob);
  }

  dlg.querySelector('[data-crop-cancel]').addEventListener('click', () => finish(null));
  dlg.addEventListener('close', () => finish(null)); // Esc
  dlg.querySelector('[data-crop-other]').addEventListener('click', () => { const again = reopen; finish(null); if (again) again(); });
  dlg.querySelector('[data-crop-ok]').addEventListener('click', () => {
    const out = document.createElement('canvas'); out.width = OUT_W; out.height = OUT_H;
    const c = out.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, OUT_W, OUT_H); // PNG com fundo transparente vira fundo branco no JPEG
    c.imageSmoothingQuality = 'high';
    const sc = scale();
    c.drawImage(img, -ox / sc, -oy / sc, VW / sc, VH / sc, 0, 0, OUT_W, OUT_H);
    out.toBlob((blob) => finish(blob), 'image/jpeg', 0.9);
  });

  window.pulsoCrop = (file, opts = {}) => new Promise((resolve) => {
    decode(file).then((bitmap) => {
      img = bitmap; iw = img.width; ih = img.height; z = 1; zoomEl.value = '1';
      ox = (VW - iw * base()) / 2;
      oy = (VH - ih * base()) * 0.15; // foto em pé: começa mostrando o alto, onde costuma estar o rosto
      settle = resolve; reopen = opts.reopen || null; decided = false;
      draw();
      dlg.showModal();
      stage.focus();
    }).catch(() => { window.alert('Não consegui abrir essa foto. Use uma imagem JPEG, PNG ou WebP.'); resolve(null); });
  });
}());
