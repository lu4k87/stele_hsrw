// Designs (#/designs): Rahmen (Header/Footer) als Liste mit Mini-Vorschau; anlegen, duplizieren, löschen.
// Darunter „Eigene Schriften“: hochladen, umbenennen, löschen (Recht „Designs bearbeiten“).
import { h, useStyles, mount as fill } from '../dom.js';
import { icon } from '../icons.js';
import { api, ApiError, errorMessage } from '../api.js';
import { can } from '../session.js';
import { formatRelative, formatDateTime, plural } from '../format.js';
import { page, pageHeader, button } from '../ui/page.js';
import { field, input, select, setFieldErrors, clearFieldErrors } from '../ui/form.js';
import { openDialog, confirmDialog, promptDialog } from '../ui/dialog.js';
import { menuButton } from '../ui/menu.js';
import { toast } from '../ui/toast.js';
import { emptyState, errorState, skeletonGrid } from '../ui/empty.js';
import { contentStyles, showInUse } from '../ui/content-common.js';
import { usedBy } from './touch-menus.js';
import { fontStack } from '/shared/fonts.js';
import { loadFonts, uploadFontDialog } from '../ui/typography.js';

export default async function mount(root, ctx) {
  await Promise.all([useStyles('/admin/css/views/designs.css'), useStyles('/admin/css/views/touch-menus.css'), contentStyles()]);
  const canEdit = can('designs.edit');
  let items = [];
  const results = h('div');
  const fontsBox = h('div');

  root.append(page({ wide: true, className: 'de-page' },
    pageHeader({
      title: 'Designs',
      description: 'Rahmen um die Folien: Header mit Logo, Titel und Uhr, Footer mit Laufband oder Text.',
      actions: canEdit ? [button({ label: 'Neues Design', icon: 'plus', variant: 'primary', onClick: () => openCreate() })] : [],
    }),
    results,
    h('section', { class: 'stack', 'aria-labelledby': 'de-fonts-title' },
      h('div', { class: 'section-title' }, h('h2', { id: 'de-fonts-title' }, 'Eigene Schriften'),
        canEdit ? h('div', { class: 'cluster' }, button({ label: 'Schrift hochladen', icon: 'upload', onClick: async () => { if (await uploadFontDialog()) loadFontList(); } })) : null),
      h('p', { class: 'text-2' }, 'Zusätzlich zu den mitgelieferten Schriften wählbar in Designs und Info-Folien. Je Datei eine Schrift; Normal und Fett einzeln hochladen.'),
      fontsBox)));

  async function load() {
    if (!items.length) fill(results, skeletonGrid(4, '300px'));
    try {
      const res = await api.get('/api/designs', { signal: ctx.signal });
      items = res.items || [];
      render();
    } catch (err) {
      if (err?.name === 'AbortError') return;
      fill(results, errorState({ error: err, onRetry: load }));
    }
  }

  function render() {
    if (!items.length) {
      fill(results, emptyState({
        icon: 'palette', title: 'Noch kein Design',
        text: 'Ein Design legt Header und Footer fest und kann von mehreren Präsentationen genutzt werden.',
        actions: canEdit ? [button({ label: 'Neues Design', icon: 'plus', variant: 'primary', onClick: () => openCreate() })] : [],
      }));
      return;
    }
    fill(results, h('ul', { class: 'de-grid', 'aria-label': 'Designs' }, items.map((d) => {
      const href = `#/designs/${d.id}`;
      return h('li', { class: 'de-card' },
        h('a', { href, class: 'de-card__sketch', tabindex: '-1', 'aria-hidden': 'true' }, designSketch(d.config, d.logo_url)),
        h('div', { class: 'de-card__body' },
          h('div', { class: 'de-card__head' },
            h('h2', { class: 'de-card__title' }, h('a', { href }, d.name)),
            menuButton({ label: `Aktionen für „${d.name}“`, items: () => [
              { label: canEdit ? 'Bearbeiten' : 'Ansehen', icon: canEdit ? 'pencil' : 'eye', href },
              canEdit ? { label: 'Duplizieren', icon: 'copy', onClick: () => duplicate(d) } : null,
              canEdit ? { separator: true } : null,
              canEdit ? { label: 'Löschen', icon: 'trash', danger: true, onClick: () => remove(d) } : null,
            ] })),
          h('p', { class: 'text-2 text-sm' }, summary(d.config)),
          usedBy(d.used_by || []),
          h('p', { class: 'text-2 text-sm', title: formatDateTime(d.updated_at) }, `Geändert ${formatRelative(d.updated_at)}${d.updated_by ? ` von ${d.updated_by.display_name}` : ''}`)));
    })));
  }

  async function openCreate() {
    const nameIn = input({ maxLength: 80, placeholder: 'z. B. Hausfarben', autoComplete: 'off' });
    const copySel = select({ value: '', options: [{ value: '', label: 'Standardwerte' }, ...items.map((d) => ({ value: String(d.id), label: `Kopie von „${d.name}“` }))] });
    const form = h('form', { class: 'form', onSubmit: (e) => e.preventDefault() },
      field({ label: 'Name', name: 'name', required: true, control: nameIn }),
      items.length ? field({ label: 'Vorlage', name: 'copy_from', control: copySel }) : null);
    openDialog({
      title: 'Neues Design',
      size: 'sm',
      content: form,
      actions: [
        { label: 'Abbrechen' },
        {
          label: 'Anlegen und bearbeiten', variant: 'primary', icon: 'plus',
          onClick: async () => {
            clearFieldErrors(form);
            const name = nameIn.value.trim();
            if (!name) { setFieldErrors(form, { name: 'Bitte einen Namen eingeben.' }); return false; }
            try {
              const d = await api.post('/api/designs', { name, ...(copySel.value ? { copy_from: Number(copySel.value) } : {}) });
              toast.success(`Design „${d.name}“ angelegt.`);
              ctx.navigate(`/designs/${d.id}`);
              return true;
            } catch (err) {
              if (err instanceof ApiError && err.fields?.name) { setFieldErrors(form, err.fields); return false; }
              throw err;
            }
          },
        },
      ],
    });
  }

  async function duplicate(d) {
    try {
      const copy = await api.post('/api/designs', { name: `${d.name} (Kopie)`.slice(0, 80), copy_from: d.id });
      toast.success(`Kopie „${copy.name}“ angelegt.`, { action: { label: 'Bearbeiten', onClick: () => ctx.navigate(`/designs/${copy.id}`) } });
      load();
    } catch (err) { toast.error(errorMessage(err)); }
  }

  async function remove(d) {
    const used = d.used_by || [];
    const ok = await confirmDialog({
      title: `„${d.name}“ löschen?`,
      message: used.length ? `Das Design wird in ${plural(used.length, 'Präsentation', 'Präsentationen')} verwendet und kann erst gelöscht werden, wenn dort ein anderes gewählt wurde.` : 'Das Design wird endgültig entfernt.',
      confirmLabel: 'Design löschen', danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/designs/${d.id}`);
      toast.success(`„${d.name}“ gelöscht.`);
      load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) await showInUse({ title: 'Design kann nicht gelöscht werden', message: err.message, usages: err.details?.usages || [] });
      else toast.error(errorMessage(err));
    }
  }

  async function loadFontList() {
    try {
      const fonts = await loadFonts(ctx.signal);
      renderFonts(fonts);
    } catch (err) {
      if (err?.name !== 'AbortError') fill(fontsBox, errorState({ error: err, onRetry: loadFontList }));
    }
  }

  function renderFonts(fonts) {
    if (!fonts.length) {
      fill(fontsBox, emptyState({ icon: 'type', title: 'Noch keine eigene Schrift', text: 'Mitgeliefert sind zehn freie Schriften. Eine Hausschrift (WOFF2, WOFF, TTF, OTF) kann hier ergänzt werden.' }));
      return;
    }
    fill(fontsBox, h('ul', { class: 'de-fonts', 'aria-label': 'Eigene Schriften' }, fonts.map((f) => {
      const used = f.usages || [];
      const meta = [f.format.toUpperCase(), f.weight ? `Stärke ${f.weight}` : 'variabel', `${Math.max(1, Math.round(f.size_bytes / 1024))} KB`];
      return h('li', { class: 'de-fontcard' },
        h('div', { class: 'de-fontcard__head' },
          h('h3', { class: 'de-fontcard__name' }, f.name),
          canEdit ? menuButton({ label: `Aktionen für „${f.name}“`, items: () => [
            { label: 'Umbenennen', icon: 'pencil', onClick: () => renameFont(f) },
            { separator: true },
            { label: 'Löschen', icon: 'trash', danger: true, onClick: () => removeFont(f) },
          ] }) : null),
        h('p', { class: 'de-fontcard__sample', style: { fontFamily: fontStack(f.key) } }, 'Aa Ää Öö Üü ß 0123'),
        h('p', { class: 'text-2 text-sm' }, meta.join(' · ')),
        h('p', { class: 'text-2 text-sm' }, used.length ? `Verwendet in ${plural(used.length, 'Stelle', 'Stellen')}` : 'Nicht verwendet'));
    })));
  }

  async function renameFont(f) {
    const name = await promptDialog({ title: 'Schrift umbenennen', label: 'Name', value: f.name, maxLength: 80 });
    if (!name || name === f.name) return;
    try {
      await api.patch(`/api/fonts/${f.id}`, { name });
      toast.success('Schrift umbenannt.');
      loadFontList();
    } catch (err) { toast.error(errorMessage(err)); }
  }

  async function removeFont(f) {
    const used = f.usages || [];
    const ok = await confirmDialog({
      title: `„${f.name}“ löschen?`,
      message: used.length ? `Die Schrift wird an ${plural(used.length, 'Stelle', 'Stellen')} verwendet und kann erst gelöscht werden, wenn dort eine andere gewählt wurde.` : 'Die Schriftdatei wird endgültig entfernt.',
      confirmLabel: 'Schrift löschen', danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/fonts/${f.id}`);
      toast.success(`„${f.name}“ gelöscht.`);
      loadFontList();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) await showInUse({ title: 'Schrift kann nicht gelöscht werden', message: err.message, usages: err.details?.usages || [] });
      else toast.error(errorMessage(err));
    }
  }

  load();
  loadFontList();
  return () => {};
}

function summary(cfg = {}) {
  const hd = cfg.header || {};
  const ft = cfg.footer || {};
  const parts = [hd.enabled ? `Header${hd.show_clock ? ' mit Uhr' : ''}` : 'ohne Header'];
  parts.push(ft.enabled ? (ft.mode === 'ticker' ? 'Laufband' : 'Footer-Text') : 'ohne Footer');
  return parts.join(' · ');
}

/** Mini-Vorschau eines Designs (Hochformat, Header/Footer maßstäblich). Auch im Editor genutzt. */
export function designSketch(cfg = {}, logoUrl = null) {
  const hd = cfg.header || {};
  const ft = cfg.footer || {};
  const theme = cfg.theme || {};
  const hPct = hd.enabled ? (hd.height || 180) / 19.2 : 0;
  const fPct = ft.enabled ? (ft.height || 96) / 19.2 : 0;
  return h('span', { class: 'de-sketch', style: { '--accent': theme.accent_color || '#F5B400', fontFamily: fontStack(theme.font) || '' }, 'aria-hidden': 'true' },
    hd.enabled ? h('span', { class: ['de-sketch__header', hd.logo_position === 'center' && 'is-center'], style: { height: `${hPct}%`, background: hd.bg_color, color: hd.text_color } },
      logoUrl ? h('img', { src: logoUrl, alt: '' }) : null,
      hd.title ? h('span', { class: 'de-sketch__title' }) : null,
      hd.show_clock ? h('span', { class: 'de-sketch__clock' }) : null) : null,
    h('span', { class: 'de-sketch__body' }, h('span', { class: 'de-sketch__rule' }), h('span', { class: 'de-sketch__line' }), h('span', { class: 'de-sketch__line short' })),
    ft.enabled ? h('span', { class: 'de-sketch__footer', style: { height: `${fPct}%`, background: ft.bg_color, color: ft.text_color } },
      ft.mode === 'ticker' || ft.text ? h('span') : null) : null);
}
