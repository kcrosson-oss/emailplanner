'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppState } from '@/lib/types';
import { currentNow, emailHealth, HEALTH_LABEL, Health } from '@/lib/workflow';
import { AppCtx, Avatar, Ctx } from './ui';
import CalendarView from './CalendarView';
import BoardView from './BoardView';
import TimelineView from './TimelineView';
import TasksView from './TasksView';
import EmailDrawer from './EmailDrawer';
import { NewEmailModal, SettingsModal } from './Modals';
import { pendingSuggestions, ReportDelayModal, ReschedulesModal } from './LaunchDelay';
import { canApproveReschedule, canReportDelay } from '@/lib/launch';

type View = 'calendar' | 'board' | 'timeline' | 'tasks';
const VIEWS: { id: View; label: string }[] = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'board', label: 'Board' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'tasks', label: 'My tasks' },
];

export default function App({ initial }: { initial: AppState }) {
  const [state, setState] = useState<AppState>(initial);
  const [now, setNow] = useState(() => currentNow());
  const [view, setView] = useState<View>('calendar');
  const [openId, setOpenId] = useState<{ emailId: number; versionId?: number } | null>(null);
  const [modal, setModal] = useState<'new' | 'settings' | 'delay' | 'reschedules' | null>(null);
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const [menu, setMenu] = useState(false);
  const busy = useRef(0);

  // Read view + open email from the URL so links are shareable.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const v = sp.get('view') as View | null;
    if (v && VIEWS.some((x) => x.id === v)) setView(v);
    const e = Number(sp.get('email'));
    if (e) setOpenId({ emailId: e, versionId: Number(sp.get('version')) || undefined });
  }, []);
  useEffect(() => {
    const sp = new URLSearchParams();
    if (view !== 'calendar') sp.set('view', view);
    if (openId) {
      sp.set('email', String(openId.emailId));
      if (openId.versionId) sp.set('version', String(openId.versionId));
    }
    const qs = sp.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [view, openId]);

  const toast = useCallback((msg: string, kind: 'error' | 'ok' = 'error') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 2500);
  }, []);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (res.ok && busy.current === 0) setState(await res.json());
  }, []);

  // Keep everyone in sync: poll every 10s while the tab is visible, and on focus.
  useEffect(() => {
    const tick = () => document.visibilityState === 'visible' && refresh();
    const iv = setInterval(tick, 10000);
    const clock = setInterval(() => setNow(currentNow()), 30000);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(iv);
      clearInterval(clock);
      window.removeEventListener('focus', tick);
    };
  }, [refresh]);

  const act = useCallback(
    async (type: string, payload: Record<string, unknown> = {}) => {
      busy.current++;
      // Optimistic check/uncheck so the UI feels instant.
      if (type === 'completeStep' || type === 'reopenStep') {
        setState((s) => ({
          ...s,
          emails: s.emails.map((e) => ({
            ...e,
            versions: e.versions.map((v) => ({
              ...v,
              steps: v.steps.map((st) =>
                st.id === payload.id
                  ? { ...st, completedAt: type === 'completeStep' ? new Date().toISOString() : null, completedById: type === 'completeStep' ? s.me.id : null }
                  : st,
              ),
            })),
          })),
        }));
      }
      try {
        const res = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, ...payload }) });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) window.location.href = '/login';
        if (!res.ok) {
          toast(data.error || 'Could not save that change.');
          return null;
        }
        return data;
      } catch {
        toast('You seem to be offline — that change was not saved.');
        return null;
      } finally {
        busy.current--;
        await refresh();
      }
    },
    [refresh, toast],
  );

  const ctx: Ctx = useMemo(
    () => ({ state, now, act, toast, openEmail: (emailId, versionId) => setOpenId({ emailId, versionId }) }),
    [state, now, act, toast],
  );

  const counts = useMemo(() => {
    const c: Record<Health, number> = { overdue: 0, today: 0, soon: 0, ontrack: 0, done: 0 };
    for (const e of state.emails) c[emailHealth(e.versions, now)]++;
    return c;
  }, [state.emails, now]);

  const pending = pendingSuggestions(state.delays);
  const openEmail = openId ? state.emails.find((e) => e.id === openId.emailId) : undefined;

  return (
    <AppCtx.Provider value={ctx}>
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">ResQ</span>
            <span className="brand-sub">Email Planner</span>
          </div>
          <nav className="tabs">
            {VIEWS.map((v) => (
              <button key={v.id} className={`tab ${view === v.id ? 'active' : ''}`} onClick={() => setView(v.id)}>
                {v.label}
              </button>
            ))}
          </nav>
          <div className="topbar-right">
            {canReportDelay(state.me) && (
              <button className="btn btn-outline-light" onClick={() => setModal('delay')}>
                Report launch delay
              </button>
            )}
            <button className="btn btn-primary" onClick={() => setModal('new')}>
              + New email
            </button>
            <div className="user-menu">
              <button className="user-btn" onClick={() => setMenu((m) => !m)}>
                <Avatar person={state.me} size={28} />
                <span className="user-name">{state.me.name.split(' ')[0]}</span>
              </button>
              {menu && (
                <div className="menu" onMouseLeave={() => setMenu(false)}>
                  <div className="menu-head">
                    {state.me.name}
                    <small>
                      {state.me.role === 'marketing' ? 'Marketing (Kori)' : state.me.role === 'ops' ? 'Ops' : 'Team member'}
                      {state.me.isAdmin ? ' · Admin' : ''}
                    </small>
                  </div>
                  <button
                    onClick={() => {
                      setMenu(false);
                      setModal('reschedules');
                    }}
                  >
                    Launch delays & reschedules
                  </button>
                  <button
                    onClick={() => {
                      setMenu(false);
                      setModal('settings');
                    }}
                  >
                    People & settings
                  </button>
                  <button
                    onClick={async () => {
                      await fetch('/api/auth/logout', { method: 'POST' });
                      window.location.href = '/login';
                    }}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="summary">
          {(['overdue', 'today', 'soon', 'ontrack', 'done'] as Health[]).map((h) => (
            <span key={h} className="summary-item">
              <span className={`dot h-${h}`} /> {HEALTH_LABEL[h]} <b>{counts[h]}</b>
            </span>
          ))}
          <span className="summary-note">Emails by health · times are Eastern · syncs every 10s</span>
        </div>

        {pending.length > 0 && (
          <button className="pending-banner" onClick={() => setModal('reschedules')}>
            <span className="pending-icon">⏱</span>
            <span>
              <b>
                {pending.length} launch email{pending.length === 1 ? '' : 's'} need{pending.length === 1 ? 's' : ''} a new send date
              </b>{' '}
              — {[...new Set(pending.map((p) => p.delay.city))].join(', ')} launch moved.{' '}
              {canApproveReschedule(state.me) ? 'Review and approve →' : 'Waiting for Marketing (Kori) to approve. View →'}
            </span>
          </button>
        )}

        <main className="main">
          {view === 'calendar' && <CalendarView />}
          {view === 'board' && <BoardView />}
          {view === 'timeline' && <TimelineView />}
          {view === 'tasks' && <TasksView />}
        </main>

        {openEmail && <EmailDrawer key={openEmail.id} email={openEmail} initialVersionId={openId?.versionId} onClose={() => setOpenId(null)} />}
        {modal === 'new' && (
          <NewEmailModal
            onClose={() => setModal(null)}
            onCreated={(id) => {
              setModal(null);
              setOpenId({ emailId: id });
            }}
          />
        )}
        {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} />}
        {modal === 'delay' && <ReportDelayModal onClose={() => setModal(null)} />}
        {modal === 'reschedules' && <ReschedulesModal onClose={() => setModal(null)} />}

        <div className="toasts">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.kind}`}>
              {t.msg}
            </div>
          ))}
        </div>
      </div>
    </AppCtx.Provider>
  );
}
