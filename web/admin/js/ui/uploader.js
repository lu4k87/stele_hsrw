// Datei-Upload in die Mediathek: Dateidialog, Drag & Drop auf die Seite, Upload-Panel mit Fortschritt je Datei.
//
//   const up = createUploader({ onUploaded: (items) => reload(), onBusy: (busy) => ctx.setDirty(busy && '…') });
//   root.append(up.el);                       // Panel (im Fluss, erscheint beim ersten Upload)
//   up.upload(await pickFiles());
//   const stopDrop = enableDropUpload(root, (files) => up.upload(files));   // Seite als Ablagefläche
import { h, mount as fill } from '../dom.js';
import { icon } from '../icons.js';
import { api, errorMessage } from '../api.js';
import { formatBytes } from '../format.js';
import { contentStyles } from './content-common.js';

export const UPLOAD_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,video/x-matroska,.mkv,.mov,application/pdf';
export const UPLOAD_HINT = 'Erlaubt: JPEG, PNG, WebP, GIF, MP4, WebM, MOV, MKV und PDF.';
const PARALLEL = 2;

/** Öffnet den Dateidialog und liefert die gewählten Dateien (leer bei Abbruch). */
export function pickFiles({ accept = UPLOAD_ACCEPT, multiple = true } = {}) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, multiple, style: 'position:fixed;left:-9999px;opacity:0' });
    let done = false;
    const finish = (files) => { if (done) return; done = true; inp.remove(); resolve(files); };
    inp.addEventListener('change', () => finish([...(inp.files || [])]));
    inp.addEventListener('cancel', () => finish([]));
    document.body.append(inp);
    inp.click();
  });
}

export function createUploader({ onUploaded = null, onBusy = null, tags = null } = {}) {
  contentStyles();
  const list = h('ul', { class: 'cu-upload__list' });
  const title = h('span', {}, 'Hochladen');
  const closeBtn = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => reset() }, icon('x', { size: 16 }), 'Liste schließen');
  const el = h('section', { class: 'cu-upload', 'aria-label': 'Hochladen', hidden: true },
    h('div', { class: 'cu-upload__head' },
      h('div', { class: 'cu-upload__title', role: 'status', 'aria-live': 'polite' }, icon('upload'), title),
      closeBtn),
    list);

  const queue = [];
  let running = 0;
  let total = 0;
  let finished = 0;
  let failed = 0;

  function reset() {
    if (running || queue.length) return;
    fill(list);
    total = 0; finished = 0; failed = 0;
    el.hidden = true;
  }

  function updateTitle() {
    const busy = running > 0 || queue.length > 0;
    closeBtn.hidden = busy;
    if (busy) title.textContent = `Wird hochgeladen … ${finished} von ${total} fertig`;
    else if (failed) title.textContent = `${finished - failed} von ${total} hochgeladen, ${failed} fehlgeschlagen`;
    else title.textContent = total === 1 ? 'Datei hochgeladen – wird ggf. noch verarbeitet' : `${total} Dateien hochgeladen – werden ggf. noch verarbeitet`;
    onBusy?.(busy);
  }

  function row(file) {
    const bar = h('div', { class: 'progress__bar', style: { width: '0%' } });
    const state = h('span', { class: 'cu-upload__state' }, 'Wartet …');
    const li = h('li', { class: 'cu-upload__row' },
      h('span', { class: 'cu-upload__name truncate', title: file.name }, file.name, h('span', { class: 'text-2' }, ` · ${formatBytes(file.size)}`)),
      state,
      h('div', { class: 'progress', role: 'progressbar', 'aria-label': `Fortschritt ${file.name}`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, bar));
    return {
      li,
      progress(p) {
        const pct = Math.round(p * 100);
        bar.style.width = `${pct}%`;
        li.querySelector('.progress').setAttribute('aria-valuenow', String(pct));
        state.textContent = pct >= 100 ? 'Wird geprüft …' : `${pct} %`;
      },
      done(item) {
        li.classList.add('is-done');
        bar.style.width = '100%';
        fill(state, icon('check-circle'), item?.status === 'processing' ? 'Hochgeladen – wird verarbeitet' : 'Fertig');
      },
      fail(msg) {
        li.classList.add('is-error');
        li.querySelector('.progress')?.classList.add('progress--danger');
        fill(state, icon('alert-circle'), 'Fehler');
        li.append(h('div', { class: 'cu-upload__msg' }, msg));
      },
    };
  }

  async function runOne(job) {
    running += 1;
    job.r.progress(0);
    try {
      const fd = new FormData();
      fd.append('files', job.file, job.file.name);
      if (tags && tags.length) fd.append('tags', JSON.stringify(tags));
      const res = await api.upload('/api/contents/upload', fd, { onProgress: (p) => job.r.progress(p) });
      const err = res?.errors?.[0];
      if (err) { job.r.fail(err.message); failed += 1; } else job.r.done(res?.items?.[0]);
      if (res?.items?.length) onUploaded?.(res.items);
    } catch (e) {
      const first = e?.details?.errors?.[0];
      job.r.fail(first?.message || errorMessage(e));
      failed += 1;
    } finally {
      running -= 1;
      finished += 1;
      updateTitle();
      pump();
    }
  }

  function pump() {
    while (running < PARALLEL && queue.length) runOne(queue.shift());
  }

  function upload(files) {
    const arr = [...(files || [])].filter((f) => f && f.size !== undefined);
    if (!arr.length) return;
    if (!running && !queue.length && finished === total) { fill(list); total = 0; finished = 0; failed = 0; }
    el.hidden = false;
    for (const file of arr) {
      const r = row(file);
      list.append(r.li);
      queue.push({ file, r });
      total += 1;
    }
    updateTitle();
    pump();
  }

  return { el, upload, get busy() { return running > 0 || queue.length > 0; } };
}

/**
 * Drag & Drop von Dateien auf die Seite. Zeigt „.drop-overlay“, solange Dateien darübergezogen werden.
 * target: Element oder window. Liefert eine Aufräumfunktion.
 */
export function enableDropUpload(onFiles, { text = 'Dateien hier ablegen, um sie hochzuladen', target = window, enabled = () => true } = {}) {
  let depth = 0;
  let overlay = null;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const show = () => {
    if (overlay) return;
    overlay = h('div', { class: 'drop-overlay', 'aria-hidden': 'true' }, h('div', {}, icon('upload', { size: 28 }), text));
    document.body.append(overlay);
  };
  const hide = () => { depth = 0; overlay?.remove(); overlay = null; };
  const onEnter = (e) => { if (!hasFiles(e) || !enabled()) return; e.preventDefault(); depth += 1; show(); };
  const onOver = (e) => { if (!hasFiles(e) || !enabled()) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
  const onLeave = (e) => { if (!hasFiles(e)) return; depth -= 1; if (depth <= 0) hide(); };
  const onDrop = (e) => {
    if (!hasFiles(e) || !enabled()) return;
    e.preventDefault();
    hide();
    const files = [...(e.dataTransfer.files || [])];
    if (files.length) onFiles(files);
  };
  target.addEventListener('dragenter', onEnter);
  target.addEventListener('dragover', onOver);
  target.addEventListener('dragleave', onLeave);
  target.addEventListener('drop', onDrop);
  return () => {
    hide();
    target.removeEventListener('dragenter', onEnter);
    target.removeEventListener('dragover', onOver);
    target.removeEventListener('dragleave', onLeave);
    target.removeEventListener('drop', onDrop);
  };
}
