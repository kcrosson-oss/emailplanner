

import { useMemo, useState } from 'react';
import { daysBetween, isWeekend, prettyDate, shortDate } from '@/lib/dates';
import { affectedVersions, canApproveReschedule, normCity, reschedulePlan, suggestSendDate } from '@/lib/launch';
import type { LaunchDelay, RescheduleSuggestion } from '@/lib/types';
import { fmtStamp, personName, useApp, WeekendFlag } from './ui';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const delayText = (oldD: string, newD: string) => {
  const n = daysBetween(oldD, newD);
  return n > 0 ? `${n} day${n === 1 ? '' : 's'} later` : `${-n} day${n === -1 ? '' : 's'} earlier`;
};

/** Ops: "the Chicago launch moved" → preview the emails it affects → send for approval. */
export function ReportDelayModal({ onClose }: { onClose: () => void }) {
  const { state, act, toast } = useApp();
  const cities = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of state.emails)
      if (e.isLaunch) for (const v of e.versions) if (v.city.trim() && !v.steps.find((s) => s.key === 'email_sent')?.completedAt) m.set(normCity(v.city), v.city.trim());
    return [...m.values()].sort();
  }, [state.emails]);

  const [city, setCity] = useState(cities[0] ?? '');
  const [other, setOther] = useState('');
  const cityName = city === '__other' ? other : city;
  const firstSend = state.emails
    .filter((e) => affectedVersions(e, cityName).length)
    .map((e) => e.sendDate)
    .sort()
    .at(-1);
  const [oldD, setOldD] = useState<string | null>(null);
  const [newD, setNewD] = useState('');
  const [reason, setReason] = useState('');
  const oldLaunch = oldD ?? firstSend ?? '';

  const preview = useMemo(() => {
    if (!cityName.trim() || !oldLaunch || !newD) return [];
    return state.emails
      .map((e) => ({ e, vs: affectedVersions(e, cityName) }))
      .filter((x) => x.vs.length)
      .map(({ e, vs }) => ({ e, vs, s: suggestSendDate(e.sendDate, oldLaunch, newD), plan: reschedulePlan(e.versions.length, vs.length) }));
  }, [state.emails, cityName, oldLaunch, newD]);

  return (
    <Modal title="Report a launch delay" onClose={onClose}>
      <form
        className="modal-body form-stack"
        onSubmit={async (ev) => {
          ev.preventDefault();
          const r = await act('reportDelay', { city: cityName, oldLaunchDate: oldLaunch, newLaunchDate: newD, reason });
          if (r) {
            toast(`Sent ${preview.length} reschedule suggestion${preview.length === 1 ? '' : 's'} for approval`, 'ok');
            onClose();
          }
        }}
      >
        <p className="muted-text">
          Tell the team a city launch moved. Every unsent <b>launch email</b> for that city gets a suggested new send date, and Marketing approves it before anything changes.
        </p>
        <div className="row-3">
          <label className="field">
            <span>City</span>
            <select value={city} onChange={(e) => { setCity(e.target.value); setOldD(null); }}>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value="__other">Other city…</option>
            </select>
            {city === '__other' && <input placeholder="City name" value={other} onChange={(e) => setOther(e.target.value)} />}
          </label>
          <label className="field">
            <span>Was launching</span>
            <input type="date" required value={oldLaunch} onChange={(e) => setOldD(e.target.value)} />
          </label>
          <label className="field">
            <span>Now launching</span>
            <input type="date" required value={newD} onChange={(e) => setNewD(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Reason (optional)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. partner techs not onboarded yet" />
        </label>

        {cityName && oldLaunch && newD && (
          <div className="delay-preview">
            <div className="delay-preview-head">
              {preview.length ? (
                <>
                  Launch moves <b>{delayText(oldLaunch, newD)}</b> · {preview.length} email{preview.length === 1 ? '' : 's'} affected
                </>
              ) : (
                <>No unsent launch emails go to {cityName}. Label the email “Launch email” and set each version’s launch city in the email’s details.</>
              )}
            </div>
            {preview.map(({ e, vs, s, plan }) => (
              <div key={e.id} className="delay-row">
                <div>
                  <b>{e.title}</b> <span className="muted-text">· {vs.map((v) => v.name).join(', ')}</span>
                  {plan === 'split' && <div className="small muted-text">Other versions stay on {shortDate(e.sendDate)}; {vs.map((v) => v.name).join(', ')} becomes its own email.</div>}
                </div>
                <div className="date-move">
                  <s>{prettyDate(e.sendDate)}</s> → <b>{prettyDate(s.date)}</b>
                  {s.movedOffWeekend && <span className="small muted-text"> (moved off weekend)</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!preview.length || !newD}>
            Send for approval
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** One suggestion with Approve (date editable) / Decline. */
export function SuggestionCard({ s, delay, compact }: { s: RescheduleSuggestion; delay: LaunchDelay; compact?: boolean }) {
  const { state, act, toast, openEmail } = useApp();
  const [date, setDate] = useState(s.suggestedDate);
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState('');
  const allowed = canApproveReschedule(state.me);

  if (s.status !== 'pending')
    return (
      <div className={`sugg sugg-${s.status}`}>
        <div>
          <b>{s.emailTitle}</b> <span className="muted-text">· {s.versionNames.join(', ')}</span>
        </div>
        <div className="small">
          {s.status === 'approved' ? `✓ Moved to ${prettyDate(s.finalDate!)}` : '✕ Declined'} by {personName(state.people, s.decidedById)}
          {s.decidedAt ? ` · ${fmtStamp(s.decidedAt)}` : ''}
          {s.note ? ` — ${s.note}` : ''}
        </div>
      </div>
    );

  return (
    <div className="sugg sugg-pending">
      <div className="sugg-main">
        <div>
          {!compact && (
            <div className="sugg-why">
              {delay.city} launch moved {shortDate(delay.oldLaunchDate)} → {shortDate(delay.newLaunchDate)}
              {delay.reason ? ` · “${delay.reason}”` : ''} · reported by {personName(state.people, delay.reportedById)}
            </div>
          )}
          <button className="sugg-title" onClick={() => s.emailId && openEmail(s.emailId, s.versionIds[0])}>
            {s.emailTitle} <span className="muted-text">· {s.versionNames.join(', ')}</span>
          </button>
          <div className="date-move">
            <s>{prettyDate(s.currentSendDate)}</s> → suggested <b>{prettyDate(s.suggestedDate)}</b>
            {s.movedOffWeekend && <span className="small muted-text"> (moved off the weekend)</span>}
          </div>
          {s.plan === 'split' && <div className="small muted-text">Only {s.versionNames.join(', ')} moves — it becomes its own email; the other versions keep their date.</div>}
        </div>
        {allowed ? (
          <div className="sugg-actions">
            <label className="field-inline">
              New send
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            {isWeekend(date) && <WeekendFlag />}
            <button className="btn btn-primary sm" onClick={async () => (await act('approveReschedule', { id: s.id, date })) && toast('Reschedule approved — due dates updated', 'ok')}>
              Approve
            </button>
            <button className="btn btn-ghost sm" onClick={() => setDeclining((d) => !d)}>
              Decline
            </button>
          </div>
        ) : (
          <span className="waiting">Waiting for Marketing (Kori) to approve</span>
        )}
      </div>
      {declining && (
        <div className="request-actions" style={{ marginTop: 8 }}>
          <input style={{ flex: 1 }} placeholder="Why? (optional — e.g. sending to Chicago anyway)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn-ghost sm danger" onClick={() => act('declineReschedule', { id: s.id, note })}>
            Decline suggestion
          </button>
        </div>
      )}
    </div>
  );
}

export const pendingSuggestions = (delays: LaunchDelay[]) =>
  delays.flatMap((d) => d.suggestions.filter((s) => s.status === 'pending').map((s) => ({ s, delay: d })));

/** Everything: pending suggestions first, then history. */
export function ReschedulesModal({ onClose }: { onClose: () => void }) {
  const { state } = useApp();
  const pending = pendingSuggestions(state.delays);
  const done = state.delays.filter((d) => d.suggestions.every((s) => s.status !== 'pending'));
  return (
    <Modal title="Launch delays & reschedules" onClose={onClose}>
      <div className="modal-body form-stack">
        <h3 className="sub-h">Waiting for approval ({pending.length})</h3>
        {pending.length ? pending.map(({ s, delay }) => <SuggestionCard key={s.id} s={s} delay={delay} />) : <div className="task-empty">Nothing waiting 🎉</div>}
        {done.length > 0 && (
          <>
            <h3 className="sub-h">Recent</h3>
            {done.map((d) => (
              <div key={d.id} className="delay-history">
                <div className="small muted-text">
                  {d.city} launch {shortDate(d.oldLaunchDate)} → {shortDate(d.newLaunchDate)} · reported by {personName(state.people, d.reportedById)} · {fmtStamp(d.createdAt)}
                </div>
                {d.suggestions.map((s) => (
                  <SuggestionCard key={s.id} s={s} delay={d} />
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </Modal>
  );
}
