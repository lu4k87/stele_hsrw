// Touch-Menüs (#/touch-menus): Liste mit Kachel-Skizze, anlegen, duplizieren, löschen.
import { h, useStyles, mount as fill } from '../dom.js';
import { icon } from '../icons.js';
import { api, ApiError, errorMessage } from '../api.js';
import { can } from '../session.js';
import { formatRelative, formatDateTime, plural } from '../format.js';
import { page, pageHeader, button } from '../ui/page.js';
import { field, input, select, setFieldErrors, clearFieldErrors } from '../ui/form.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { menuButton } from '../ui/menu.js';
import { toast } from '../ui/toast.js';
import { presentationStatus } from '../ui/status.js';
import { emptyState, errorState, skeletonGrid } from '../ui/empty.js';
import { contentStyles, showInUse } from '../ui/content-common.js';

export default async function mount(root, ctx) {
  await Promise.all([useStyles('/admin/css/views/touch-menus.css'), contentStyles()]);
  const canEdit = can('touch.edit');
  let items = [];

  const results = h('div');
  root.append(page({ wide: true, className: 'tm-page' },
    pageHeader({
      title: 'Touch-Menüs',
      description: 'Was Besucher sehen, wenn sie die Stele antippen: Kacheln mit Inhalten, Galerien oder Untermenüs.',
      actions: canEdit ? [button({ label: 'Neues Touch-Menü', icon: 'plus', variant: 'primary', onClick: () => openCreate() })] : [],
    }),
    results));

  async function load() {
    if (!items.length) fill(results, skeletonGrid(4, '300px'));
    try {
      const res = await api.get('/api/touch-menus', { signal: ctx.signal });
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
        icon: 'touch', title: 'Noch kein Touch-Menü',
        text: 'Ein Touch-Menü macht die Stele interaktiv: Besucher tippen auf Kacheln und sehen Inhalte, Galerien oder Untermenüs. Es wird in einer Präsentation ausgewählt.',
        actions: canEdit ? [button({ label: 'Neues Touch-Menü', icon: 'plus', variant: 'primary', onClick: () => openCreate() })] : [],
      }));
      return;
    }
    fill(results, h('ul', { class: 'tm-grid', 'aria-label': 'Touch-Menüs' }, items.map((m) => {
      const href = `#/touch-menus/${m.id}`;
      const tiles = m.config?.tiles || [];
      return h('li', { class: 'tm-card' },
        h('a', { class: 'tm-card__sketch', href, tabindex: '-1', 'aria-hidden': 'true', style: { '--tm-cols': String(m.config?.columns || 2) } },
          tiles.length ? tiles.slice(0, 9).map((t) => h('span', { class: 'tm-mini', style: { '--tile': t.color || '#1E5AA8' } }, icon(t.icon || 'info', { size: 16 })))
            : h('span', { class: 'tm-card__none' }, 'Keine Kacheln')),
        h('div', { class: 'tm-card__body' },
          h('div', { class: 'tm-card__head' },
            h('h2', { class: 'tm-card__title' }, h('a', { href }, m.name)),
            menuButton({ label: `Aktionen für „${m.name}“`, items: () => [
              { label: canEdit ? 'Bearbeiten' : 'Ansehen', icon: canEdit ? 'pencil' : 'eye', href },
              canEdit ? { label: 'Duplizieren', icon: 'copy', onClick: () => duplicate(m) } : null,
              canEdit ? { separator: true } : null,
              canEdit ? { label: 'Löschen', icon: 'trash', danger: true, onClick: () => remove(m) } : null,
            ] })),
          h('p', { class: 'text-2 text-sm' }, `${plural(tiles.length, 'Kachel', 'Kacheln')} · ${m.config?.columns || 2} Spalten · Rückkehr nach ${m.config?.idle_timeout_s || 60} s`),
          usedBy(m.used_by || []),
          h('p', { class: 'text-2 text-sm', title: formatDateTime(m.updated_at) }, `Geändert ${formatRelative(m.updated_at)}${m.updated_by ? ` von ${m.updated_by.display_name}` : ''}`)));
    })));
  }

  async function openCreate(copyFrom = null) {
    const nameIn = input({ maxLength: 80, placeholder: 'z. B. Besucherinformation', autoComplete: 'off' });
    const copySel = select({ value: copyFrom ? String(copyFrom.id) : '', options: [{ value: '', label: 'Leer beginnen' }, ...items.map((m) => ({ value: String(m.id), label: `Kopie von „${m.name}“` }))] });
    const form = h('form', { class: 'form', onSubmit: (e) => e.preventDefault() },
      field({ label: 'Name', name: 'name', required: true, control: nameIn, hint: 'Nur im CMS sichtbar.' }),
      items.length ? field({ label: 'Vorlage', name: 'copy_from', control: copySel }) : null);
    openDialog({
      title: 'Neues Touch-Menü',
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
              const m = await api.post('/api/touch-menus', { name, ...(copySel.value ? { copy_from: Number(copySel.value) } : {}) });
              toast.success(`Touch-Menü „${m.name}“ angelegt.`);
              ctx.navigate(`/touch-menus/${m.id}`);
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

  async function duplicate(m) {
    try {
      const copy = await api.post('/api/touch-menus', { name: `${m.name} (Kopie)`.slice(0, 80), copy_from: m.id });
      toast.success(`Kopie „${copy.name}“ angelegt.`, { action: { label: 'Bearbeiten', onClick: () => ctx.navigate(`/touch-menus/${copy.id}`) } });
      load();
    } catch (err) { toast.error(errorMessage(err)); }
  }

  async function remove(m) {
    const used = m.used_by || [];
    const ok = await confirmDialog({
      title: `„${m.name}“ löschen?`,
      message: used.length ? `Das Touch-Menü wird in ${plural(used.length, 'Präsentation', 'Präsentationen')} verwendet und kann erst gelöscht werden, wenn es dort ersetzt wurde.` : 'Das Touch-Menü wird endgültig entfernt. Die Inhalte bleiben in der Mediathek.',
      confirmLabel: 'Touch-Menü löschen', danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/touch-menus/${m.id}`);
      toast.success(`„${m.name}“ gelöscht.`);
      load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) await showInUse({ title: 'Touch-Menü kann nicht gelöscht werden', message: err.message, usages: err.details?.usages || [] });
      else toast.error(errorMessage(err));
    }
  }

  load();
  return () => {};
}

/** „Verwendet in …“ mit Links und Status (auch für Designs genutzt). */
export function usedBy(list) {
  if (!list.length) return h('p', { class: 'text-2 text-sm' }, 'In keiner Präsentation verwendet');
  return h('div', { class: 'tm-usedby' },
    h('span', { class: 'text-2 text-sm' }, 'Verwendet in:'),
    h('ul', {}, list.map((p) => h('li', {}, h('a', { href: `#/presentations/${p.id}` }, p.name), p.status && p.status !== 'published' ? presentationStatus(p, { size: 'sm' }) : null))));
}
