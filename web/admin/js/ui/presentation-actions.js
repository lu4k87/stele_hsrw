// Gemeinsame Aktionen rund um Präsentationen (Liste, Präsentations-, Design- und Touch-Menü-Editor).
//
//   await removePresentation(p, { beforeDelete })   → true, wenn gelöscht; läuft sie noch auf Stelen: Hinweis statt Löschen
//   await publishPresentation(id, body)             → Presentation; seit dem Einreichen geändert (409) → Rückfrage
//   affectedPresentations(list, { what, onPublished }) → Hinweis „Änderungen offen in n Präsentationen“ (+ Veröffentlichen) oder null
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { api, ApiError, errorMessage } from '../api.js';
import { can } from '../session.js';
import { plural } from '../format.js';
import { button } from './page.js';
import { confirmDialog } from './dialog.js';
import { toast } from './toast.js';
import { showInUse } from './content-common.js';

/** used_by (Stele/Zeitplan) → Einträge für showInUse. */
function usagesOf(p) {
  return (p.used_by || []).map((u) => (u.how === 'schedule'
    ? { type: 'schedule', id: u.stele_id, name: u.stele_name, stele_id: u.stele_id }
    : { type: 'stele', id: u.stele_id, name: u.stele_name }));
}

/**
 * Präsentation löschen. Wird sie noch verwendet, erscheint gleich der Hinweis mit den Stellen (kein Lösch-Dialog).
 * beforeDelete: async, läuft nach der Bestätigung und vor dem Löschen (z. B. offene Änderungen speichern).
 */
export async function removePresentation(p, { beforeDelete = null } = {}) {
  const title = 'Präsentation kann nicht gelöscht werden';
  if ((p.used_by || []).length) {
    await showInUse({ title, message: `„${p.name}“ läuft noch auf diesen Stelen. Bitte dort zuerst eine andere Präsentation wählen:`, usages: usagesOf(p) });
    return false;
  }
  const ok = await confirmDialog({
    title: `„${p.name}“ löschen?`,
    message: 'Die Präsentation mit allen Folien-Einstellungen wird endgültig entfernt. Die Inhalte bleiben in der Mediathek.',
    confirmLabel: 'Präsentation löschen',
    danger: true,
  });
  if (!ok) return false;
  try {
    if (beforeDelete) await beforeDelete();
    await api.del(`/api/presentations/${p.id}`);
    toast.success(`„${p.name}“ gelöscht.`);
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) await showInUse({ title, message: err.message, usages: err.details?.usages || [] });
    else toast.error(errorMessage(err));
    return false;
  }
}

/**
 * Veröffentlichen. Wurde eine eingereichte Präsentation seitdem geändert (409 changed_since_review),
 * fragt ein Dialog nach; bei Bestätigung erneut mit confirm_changed. Abbruch → null. Andere Fehler werden geworfen.
 */
export async function publishPresentation(id, body = {}) {
  try {
    return await api.post(`/api/presentations/${id}/publish`, body);
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== 'changed_since_review') throw err;
    const ok = await confirmDialog({
      title: 'Seit dem Einreichen geändert',
      message: `${err.message} Den aktuellen Stand trotzdem veröffentlichen?`,
      confirmLabel: 'Aktuellen Stand veröffentlichen',
      icon: 'broadcast',
    });
    if (!ok) return null;
    return api.post(`/api/presentations/${id}/publish`, { ...body, confirm_changed: true });
  }
}

/**
 * Hinweis nach dem Speichern eines Designs/Touch-Menüs: betroffene Präsentationen mit offenen Änderungen,
 * mit Veröffentlichungsrecht je Zeile „Veröffentlichen“. what: „das neue Design“, „das geänderte Touch-Menü“.
 */
export function affectedPresentations(list, { what, onPublished = null } = {}) {
  const canPublish = can('presentations.publish');
  const open = (list || []).filter((p) => p.status === 'changed');
  if (!open.length) return null;
  const box = h('div', { class: 'alert alert--warning' });
  const render = () => {
    const rest = open.filter((p) => p.status === 'changed');
    if (!rest.length) { box.remove(); return; }
    box.replaceChildren(icon('alert-triangle'), h('div', { class: 'alert__body' },
      h('div', { class: 'alert__title' }, `Änderungen offen in ${plural(rest.length, 'Präsentation', 'Präsentationen')}`),
      h('div', { class: 'alert__text' }, canPublish ? `Auf den Stelen erscheint ${what} erst nach dem Veröffentlichen. Jetzt veröffentlichen?` : `Auf den Stelen erscheint ${what} erst, wenn die Präsentationen veröffentlicht werden.`),
      h('ul', { class: 'stack stack--sm', style: { listStyle: 'none', margin: 'var(--sp-2) 0 0', padding: 0 } }, rest.map((p) => {
        const row = h('li', { class: 'cluster' }, h('a', { href: `#/presentations/${p.id}` }, p.name));
        if (canPublish) {
          row.append(button({ label: 'Veröffentlichen', icon: 'broadcast', variant: 'secondary', size: 'sm', onClick: async (e) => {
            const btn = e.currentTarget;
            const ok = await confirmDialog({ title: `„${p.name}“ veröffentlichen?`, message: `Der aktuelle Entwurf der Präsentation (inkl. ${what}) geht auf die Stelen, auf denen sie läuft.`, confirmLabel: 'Veröffentlichen', icon: 'broadcast' });
            if (!ok) return;
            btn.setAttribute('aria-busy', 'true');
            try {
              if (!(await publishPresentation(p.id))) return;
              toast.success(`„${p.name}“ veröffentlicht.`);
              p.status = 'published';
              render();
              onPublished?.(p);
            } catch (err) {
              toast.error(errorMessage(err));
            } finally { btn.removeAttribute('aria-busy'); }
          } }));
        }
        return row;
      }))));
  };
  render();
  return box;
}
