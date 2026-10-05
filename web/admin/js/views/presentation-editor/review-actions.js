// Veröffentlichen und Freigabe (Vier-Augen-Prinzip) im Präsentations-Editor: Dialoge, 422 „nicht bereit“.
// Zustand bleibt im Editor; env liefert Getter (pres, meta, items) und Rückrufe (applyServer, render…).
import { h } from '../../dom.js';
import { icon } from '../../icons.js';
import { api, ApiError } from '../../api.js';
import { formatDuration, plural } from '../../format.js';
import { field, textarea } from '../../ui/form.js';
import { openDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { publishPresentation } from '../../ui/presentation-actions.js';
import { setErr } from './props.js';

/** → { publish, requestReview, reject } */
export function reviewActions(env) {
  const { id, ctx, pres, meta, items, totalDuration, ensureSaved, applyServer, setProblems,
    renderHeaderParts, renderBanners, renderList } = env;

  function noteField(label, { required = false, hint = null } = {}) {
    const ta = textarea({ rows: 3, maxLength: 500 });
    const f = field({ label, control: ta, required, optional: !required, hint });
    f.getValue = () => ta.value.trim();
    return f;
  }

  async function publish() {
    if (!(await ensureSaved())) return;
    const used = pres().used_by || [];
    const activeCount = items().filter((it) => it.enabled).length;
    const note = noteField('Notiz fürs Protokoll');
    const dlg = openDialog({
      title: 'Präsentation veröffentlichen?',
      size: 'md',
      content: h('div', { class: 'stack' },
        h('p', {}, `„${meta().name}“ mit ${plural(activeCount, 'aktiven Folie', 'aktiven Folien')} (${formatDuration(totalDuration())} je Durchlauf).`),
        used.length
          ? h('div', { class: 'alert alert--warning' }, icon('stele'), h('div', { class: 'alert__body' },
            h('div', { class: 'alert__title' }, 'Wird sofort auf den Stelen sichtbar'),
            h('ul', { class: 'alert__text', style: { margin: 0 } }, used.map((u) => h('li', {}, `${u.stele_name} (${u.how === 'schedule' ? 'laut Zeitplan' : 'Standard-Präsentation'})`)))))
          : h('div', { class: 'alert alert--neutral' }, icon('info'), h('div', { class: 'alert__body' }, h('div', { class: 'alert__text' },
            'Die Präsentation ist noch keiner Stele zugeordnet. Nach dem Veröffentlichen kann sie im Zeitplan oder als Standard einer Stele gewählt werden.'))),
        note),
      actions: [
        { label: 'Abbrechen', value: null },
        { label: 'Veröffentlichen', variant: 'primary', icon: 'broadcast', onClick: () => doPublish(note.getValue()) },
      ],
    });
    await dlg.result;
  }

  async function doPublish(noteText) {
    try {
      const res = await publishPresentation(id, noteText ? { note: noteText } : {});
      if (!res) return true;
      setProblems(new Map());
      applyServer(res, null);
      renderHeaderParts();
      renderList();
      ctx.refreshNav();
      toast.success(`„${meta().name}“ veröffentlicht.${(pres().used_by || []).length ? ' Die Stelen übernehmen den neuen Stand in Kürze.' : ''}`);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setProblems(new Map((err.details?.items || []).map((b) => [b.item_id, b.status === 'processing' ? 'wird noch verarbeitet' : b.status === 'missing' ? 'Inhalt fehlt' : 'Verarbeitung fehlgeschlagen'])));
        renderBanners();
        renderList();
        toast.error(err.message);
        return true;
      }
      throw err;
    }
  }

  async function requestReview() {
    if (!(await ensureSaved())) return;
    const note = noteField('Notiz für die Freigabe', { hint: 'z. B. was geändert wurde oder bis wann es live sein soll.' });
    openDialog({
      title: 'Zur Freigabe einreichen',
      description: 'Eine Person mit Veröffentlichungsrecht prüft den Entwurf und veröffentlicht ihn.',
      size: 'md',
      content: note,
      actions: [
        { label: 'Abbrechen', value: null },
        {
          label: 'Einreichen', variant: 'primary', icon: 'send',
          onClick: async () => {
            const res = await api.post(`/api/presentations/${id}/request-review`, note.getValue() ? { note: note.getValue() } : {});
            applyServer(res, null);
            renderHeaderParts();
            ctx.refreshNav();
            toast.success('Zur Freigabe eingereicht.');
          },
        },
      ],
    });
  }

  async function reject() {
    const note = noteField('Begründung', { required: true, hint: 'Was muss geändert werden? Die Begründung sieht die einreichende Person.' });
    openDialog({
      title: 'Freigabe ablehnen',
      size: 'md',
      content: note,
      actions: [
        { label: 'Abbrechen', value: null },
        {
          label: 'Ablehnen', variant: 'danger', icon: 'x-circle',
          onClick: async () => {
            const v = note.getValue();
            if (!v) { setErr(note, 'Bitte eine Begründung eingeben.'); note.querySelector('textarea').focus(); return false; }
            const res = await api.post(`/api/presentations/${id}/reject`, { note: v });
            applyServer(res, null);
            renderHeaderParts();
            ctx.refreshNav();
            toast.success('Freigabe abgelehnt.');
            return true;
          },
        },
      ],
    });
  }

  return { publish, requestReview, reject };
}
