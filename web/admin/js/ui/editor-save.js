// Speichern per Knopf (Strg+S) für Editoren mit Entwurf im Browser (Touch-Menü, Design, Info-Folie):
// „Ungespeicherte Änderungen“, Schutz beim Verlassen, Feldfehler der API, Bearbeitungskonflikt (ui/edit-conflict.js).
//
//   const ed = editorSave({ ctx, ro, formRoot, snapshot: () => ({ name, cfg }), send: () => api.patch(…),
//     onSaved: (res, untouched) => { ed.markSaved(…); ed.changed(untouched); }, onReload });
//   header actions: ed.saveState, ed.saveBtn · Seite: ed.conflictBox · Änderung: ed.changed() · Cleanup: ed.destroy()
import { h, mount as fill } from '../dom.js';
import { ApiError, errorMessage } from '../api.js';
import { button } from './page.js';
import { setFieldErrors, clearFieldErrors } from './form.js';
import { toast } from './toast.js';
import { clone, sameJson } from './content-common.js';
import { isEditConflict, editConflictAlert } from './edit-conflict.js';

/**
 * snapshot()  → bearbeiteter Stand (wird geklont verglichen)
 * validate()  → false = nicht absenden (Meldung zeigt die Ansicht)
 * send()      → Promise der API-Antwort
 * onSaved(res, untouched) → Antwort übernehmen; untouched = während des Speicherns nichts geändert.
 *              Ruft markSaved(Stand des Servers) und changed(); ohne markSaved bleibt der Stand ungespeichert.
 * fieldMap(key) → API-Feldname auf data-field der Form (null = Feldfehler nicht am Feld zeigen)
 * fieldToast(rest, err) → Meldung für Feldfehler, die keinem Feld zugeordnet sind
 * onReload    → mit Wert: 409 edit_conflict zeigt conflictBox mit „Neu laden“
 * emphasize   → Knopf nur bei Änderungen primary (sonst immer primary)
 */
export function editorSave({
  ctx, ro = false, formRoot, snapshot, validate = null, send, onSaved, onChanged = null,
  fieldMap = (k) => k, fieldToast = (rest, err) => Object.values(rest)[0] || err.message, onReload = null,
  label = 'Speichern', emphasize = true, stateClass, dirtyMessage, savedLabel = 'Gespeichert',
}) {
  let saved = clone(snapshot());
  let saving = false;
  const saveBtn = button({ label, icon: 'save', variant: emphasize ? 'secondary' : 'primary', onClick: () => save() });
  const saveState = h('span', { class: stateClass, role: 'status', 'aria-live': 'polite' });
  const conflictBox = onReload ? h('div', { hidden: true }) : null;
  const isDirty = () => !sameJson(snapshot(), saved);

  function changed(preview = true) {
    const dirty = isDirty();
    ctx.setDirty(dirty ? dirtyMessage : false);
    saveState.textContent = dirty ? 'Ungespeicherte Änderungen' : savedLabel;
    saveState.classList.toggle('is-dirty', dirty);
    if (emphasize) {
      saveBtn.classList.toggle('btn--primary', dirty);
      saveBtn.classList.toggle('btn--secondary', !dirty);
    }
    onChanged?.(preview);
  }

  async function save() {
    if (saving || ro) return;
    clearFieldErrors(formRoot);
    if (validate && validate() === false) return;
    saving = true;
    saveBtn.setAttribute('aria-busy', 'true');
    // Stand beim Absenden: Server-Antwort nur übernehmen, wenn währenddessen nichts geändert wurde
    const sent = clone(snapshot());
    try {
      const res = await send();
      await onSaved(res, sameJson(snapshot(), sent));
    } catch (err) {
      if (conflictBox && isEditConflict(err)) {
        fill(conflictBox, editConflictAlert(err, { onReload }));
        conflictBox.hidden = false;
      } else if (err instanceof ApiError && err.fields && Object.keys(err.fields).length) {
        let rest = err.fields;
        if (fieldMap) {
          const mapped = {};
          for (const [k, v] of Object.entries(err.fields)) mapped[fieldMap(k)] = v;
          rest = setFieldErrors(formRoot, mapped);
        }
        toast.error(fieldToast(rest, err));
      } else toast.error(errorMessage(err));
    } finally {
      saving = false;
      saveBtn.removeAttribute('aria-busy');
    }
  }

  const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } };
  document.addEventListener('keydown', onKey);

  return {
    saveBtn, saveState, conflictBox, changed, isDirty, save,
    /** Gespeicherten Stand setzen (z. B. Stand des Servers nach dem Speichern). */
    markSaved(snap = snapshot()) { saved = clone(snap); },
    destroy() { document.removeEventListener('keydown', onKey); },
  };
}
