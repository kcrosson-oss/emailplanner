import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppState } from '@/lib/types';
import { ROLE_LABELS } from '@/lib/types';
import { CATEGORIES, type Category } from '@/lib/categories';
import { currentNow, emailHealth, HEALTH_LABEL, Health } from '@/lib/workflow';
import { canApproveReschedule, canReportDelay } from '@/lib/launch';
import { AppCtx, Avatar, Ctx } from './ui';
import CalendarView from './CalendarView';
import BoardView from './BoardView';
import TimelineView from './TimelineView';
import TasksView from './TasksView';
import EmailDrawer from './EmailDrawer';
import { NewEmailModal, SettingsModal } from './Modals';
import { pendingSuggestions, ReportDelayModal, ReschedulesModal } from './LaunchDelay';
import type { Store } from '../store';
import { UserError } from '../store';

type View = 'calendar' | 'board' | 'timeline' | 'tasks';
const VIEWS: { id: View; label: string }[] = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'board', label: 'Board' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'tasks', label: 'My tasks' },
];
const viewFromHash = (): View => {
  const h = window.location.hash.replace('#', '') as View;
  return VIEWS.some((v) => v.id === h) ? h : 'calendar';
};

type Dialog = { message: string; confirm?: string; danger?: boolean; text?: boolean; placeholder?: string; resolve: (v: any) => void };

export default function App({ store }: { store: Store }) {
  const [state, setState] = useState<AppState | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'slow' | 'error'>('loading');
  const [error, setError] = useState<string | undefined>();
  const [now, setNow] = useState(() => currentNow());
  const [view, setView] = useState<View>(viewFromHash);
  const [openId, setOpenId] = useState<{ emailId: string; versionId?: string } | null>(null);
  const [modal, setModal] = useState<'new' | 'settings' | 'delay' | 'reschedules' | null>(null);
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [dialogText, setDialogText] = useState('');
  const [catFilter, setCatFilter] = useState<Category | 'all'>('all');
  const busy = useRef(0);

  useEffect(() => store.subscribe((s, st, err) => {
    if (s) setState(s);
    setStatus(st);
    setError(err);
  }), [store]);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    const clock = setInterval(() => setNow(currentNow()), 30000);
    return () => {
      window.removeEventListener('hashchange', onHash);
      clearInterval(clock);
    };
  }, []);
  const go = (v: View) => {
    setView(v);
    try {
      history.replaceState(null, '', v === 'calendar' ? ' ' : `#${v}`);
    } catch {
      window.location.hash = v;
    }
  };

  const toast = useCallback((msg: string, kind: 'error' | 'ok' = 'error') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 2500);
  }, []);

  const ask = useCallback(
    (message: string, opts: { confirm?: string; danger?: boolean } = {}) => new Promise<boolean>((resolve) => setDialog({ message, ...opts, resolve })),
    [],
  );
  const askText = useCallback(
    (message: string, placeholder?: string) =>
      new Promise<string | null>((resolve) => {
        setDialogText('');
        setDialog({ message, text: true, placeholder, confirm: 'Add', resolve });
      }),
    [],
  );
  const closeDialog = (v: any) => {
    dialog?.resolve(v);
    setDialog(null);
  };

  const act = useCallback(
    async (type: string, payload: Record<string, unknown> = {}) => {
      busy.current++;
      try {
        return (await store.act(type, payload)) ?? {};
      } catch (e: any) {
        if (e instanceof UserError) toast(e.message);
        else if (e?.code === 'invalid_argument') toast('You have view-only access, so changes can’t be saved. Ask Kori for Contributor access.');
        else if (e?.code === 'quota_exceeded') toast('The planner’s storage is full. Delete some old emails and try again.');
        else {
          console.error(e);
          toast('Something went wrong saving that. Please try again.');
        }
        return null;
      } finally {
        busy.current--;
      }
    },
    [store, toast],
  );

  const viewState = useMemo(
    () => (state && catFilter !== 'all' ? { ...state, emails: state.emails.filter((e) => e.category === catFilter) } : state),
    [state, catFilter],
  );
  const ctx: Ctx | null = useMemo(
    () =>
      viewState && {
        state: viewState,
        now,
        act,
        toast,
        ask,
        askText,
        watchActivity: store.watchActivity,
        searchPeople: store.searchPeople,
        openEmail: (emailId: string, versionId?: string) => setOpenId({ emailId, versionId }),
      },
    [viewState, now, act, toast, ask, askText, store],
  );

  const counts = useMemo(() => {
    const c: Record<Health, number> = { overdue: 0, today: 0, soon: 0, ontrack: 0, done: 0 };
    for (const e of state?.emails ?? []) c[emailHealth(e.versions, now)]++;
    return c;
  }, [state?.emails, now]);

  if (!state || !ctx)
    return (
      <div className="boot">
        <div className="boot-card">
          <span className="brand-mark">ResQ</span> <span className="brand-sub dark">Email Planner</span>
          <p className="muted-text">
            {status === 'error'
              ? error || 'The planner’s data couldn’t be loaded.'
              : status === 'slow'
                ? 'Still connecting to the shared planner… If this keeps up, check your connection.'
                : 'Loading the team’s emails…'}
          </p>
        </div>
      </div>
    );

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
              <button key={v.id} className={`tab ${view === v.id ? 'active' : ''}`} onClick={() => go(v.id)}>
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
                      {ROLE_LABELS[state.me.role] ?? 'Team member'}
                      {state.me.isAdmin ? ' · Admin' : ''}
                    </small>
                  </div>
                  <button onClick={() => { setMenu(false); setModal('reschedules'); }}>Launch delays & reschedules</button>
                  <button onClick={() => { setMenu(false); setModal('settings'); }}>People & roles</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="catbar">
          <span className="muted-text small">Show</span>
          <button className={`cat-opt ${catFilter === 'all' ? 'on all' : ''}`} onClick={() => setCatFilter('all')}>
            All emails <b>{state.emails.length}</b>
          </button>
          {CATEGORIES.map((c) => {
            const n = state.emails.filter((e) => e.category === c.id).length;
            return (
              <button
                key={c.id}
                className={`cat-opt ${catFilter === c.id ? 'on' : ''}`}
                style={catFilter === c.id ? { background: c.bg, color: c.color, borderColor: c.bg } : { borderLeft: `4px solid ${c.bg}` }}
                onClick={() => setCatFilter(c.id)}
              >
                {c.label} <b>{n}</b>
              </button>
            );
          })}
        </div>

        <div className="summary">
          {(['overdue', 'today', 'soon', 'ontrack', 'done'] as Health[]).map((h) => (
            <span key={h} className="summary-item">
              <span className={`dot h-${h}`} /> {HEALTH_LABEL[h]} <b>{counts[h]}</b>
            </span>
          ))}
          <span className="summary-note">{status === 'error' ? `⚠ ${error ?? 'Not syncing'}` : 'Emails by health · times are Eastern · live for everyone'}</span>
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

        {dialog && (
          <div className="modal-wrap" style={{ zIndex: 70 }} onMouseDown={(e) => e.target === e.currentTarget && closeDialog(dialog.text ? null : false)}>
            <form
              className="modal dialog"
              onSubmit={(e) => {
                e.preventDefault();
                closeDialog(dialog.text ? dialogText.trim() || null : true);
              }}
            >
              <div className="modal-body form-stack">
                <p className="dialog-msg">{dialog.message}</p>
                {dialog.text && <input autoFocus value={dialogText} placeholder={dialog.placeholder} onChange={(e) => setDialogText(e.target.value)} />}
                <div className="modal-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => closeDialog(dialog.text ? null : false)}>
                    Cancel
                  </button>
                  <button autoFocus={!dialog.text} className={`btn ${dialog.danger ? 'btn-danger' : 'btn-primary'}`} disabled={dialog.text && !dialogText.trim()}>
                    {dialog.confirm ?? 'OK'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}

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
