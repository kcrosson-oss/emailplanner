

import { useState } from 'react';
import { canComplete, nextStep, StageId, STAGES, stageOf, stepDef, stepHealth, versionHealth } from '@/lib/workflow';
import { shortDate } from '@/lib/dates';
import type { Email, Version } from '@/lib/types';
import { Avatar, CategoryBadge, dueLabel, HealthDot, ProgressBar, useApp } from './ui';
import { Legend } from './CalendarView';

export default function BoardView() {
  const { state, act, ask } = useApp();
  const [hideSent, setHideSent] = useState(false);
  const [over, setOver] = useState<StageId | null>(null);
  const cards = state.emails.flatMap((e) => e.versions.map((v) => ({ email: e, version: v, stage: stageOf(v.steps) })));

  const onDrop = async (target: StageId, data: string) => {
    setOver(null);
    const [vid, from] = data.split(':');
    if (!vid || from === target) return;
    const backward = STAGES.findIndex((s) => s.id === target) < STAGES.findIndex((s) => s.id === from);
    if (backward && !(await ask('Moving this card back will un-check the steps after that column. Continue?', { confirm: 'Move it back' }))) return;
    await act('moveVersion', { id: vid, stage: target });
  };

  return (
    <section className="view">
      <div className="view-toolbar">
        <div className="toolbar-group">
          <h2 className="view-title">Board</h2>
          <span className="muted-text">Drag a card to a column, or check off its next step.</span>
        </div>
        <div className="toolbar-group">
          <Legend />
          <label className="check-inline">
            <input type="checkbox" checked={hideSent} onChange={(e) => setHideSent(e.target.checked)} /> Hide sent
          </label>
        </div>
      </div>
      <div className="board">
        {STAGES.filter((s) => !(hideSent && s.id === 'sent')).map((col) => {
          const colCards = cards.filter((c) => c.stage === col.id).sort((a, b) => a.email.sendDate.localeCompare(b.email.sendDate));
          return (
            <div
              key={col.id}
              className={`col ${over === col.id ? 'drop' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(col.id);
              }}
              onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                onDrop(col.id, e.dataTransfer.getData('text/plain'));
              }}
            >
              <div className="col-head">
                <span className={`col-icon col-${col.id}`} />
                {col.label}
                <span className="count">{colCards.length}</span>
              </div>
              <div className="col-body">
                {colCards.map((c) => (
                  <Card key={c.version.id} email={c.email} version={c.version} stage={c.stage} />
                ))}
                {!colCards.length && <div className="col-empty">Nothing here</div>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Card({ email, version, stage }: { email: Email; version: Version; stage: StageId }) {
  const { state, now, act, openEmail, toast } = useApp();
  const h = versionHealth(version.steps, now);
  const next = nextStep(version.steps);
  const assignee = state.people.find((p) => p.id === next?.assigneeId);
  const check = next ? canComplete(next.key, version.steps, state.me) : { ok: false };
  const flagged = version.steps.find((s) => s.changesRequested);

  return (
    <div
      className={`card h-border-${h}`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', `${version.id}:${stage}`)}
      onClick={() => openEmail(email.id, version.id)}
    >
      <CategoryBadge category={email.category} small />
      <div className="card-top">
        <span className="card-title">{email.title}</span>
        <HealthDot health={h} />
      </div>
      <div className="card-sub">
        <span className="tag">{version.name}</span>
        <span className="muted-text">Send {shortDate(email.sendDate)}</span>
      </div>
      <ProgressBar steps={version.steps} health={h} wide />
      {flagged && <div className="card-flag">↺ Changes requested</div>}
      {next ? (
        <div className="card-next" onClick={(e) => e.stopPropagation()}>
          <label className={`next-check ${check.ok ? '' : 'blocked'}`} title={check.ok ? 'Mark done' : check.reason}>
            <input
              type="checkbox"
              checked={false}
              onChange={() => (check.ok ? act('completeStep', { id: next.id }) : toast(check.reason ?? 'Not allowed'))}
            />
            <span>
              <b>{stepDef(next.key).short}</b>
              <small className={`h-text-${stepHealth(next, now)}`}>{dueLabel(next, now)}</small>
            </span>
          </label>
          <Avatar person={assignee} />
        </div>
      ) : (
        <div className="card-next done-text">✓ Sent</div>
      )}
    </div>
  );
}
