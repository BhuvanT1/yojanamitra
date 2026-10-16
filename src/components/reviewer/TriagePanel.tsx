import type { TriageClass, TriageSummary } from '@/triage/predict';

const LABEL: Record<TriageClass, { title: string; work: string; tone: string; bar: string }> = {
  machine_checkable: {
    title: 'Confirm a draft',
    work: 'A constraint is already proposed — read it and approve or correct it.',
    tone: 'text-yes',
    bar: 'bg-yes',
  },
  no_pattern: {
    title: 'Write one by hand',
    work: 'Nothing matched. The constraint has to be written from the clause text.',
    tone: 'text-brand',
    bar: 'bg-brand',
  },
  needs_schema_extension: {
    title: 'Needs a new field',
    work: 'Checkable in principle, but the profile schema lacks the field it tests.',
    tone: 'text-maybe',
    bar: 'bg-maybe',
  },
  not_machine_checkable: {
    title: 'Mark un-checkable',
    work: 'No machine can decide this one — mark it and move on.',
    tone: 'text-muted',
    bar: 'bg-line-strong',
  },
};

const ORDER: TriageClass[] = [
  'machine_checkable',
  'no_pattern',
  'needs_schema_extension',
  'not_machine_checkable',
];

/**
 * The triage model's output, on the only screen where it belongs.
 *
 * A backlog of ten thousand undifferentiated clauses is the reason this queue
 * never gets worked. Predicting what KIND of attention each one needs turns it
 * into an ordered worklist: the confirmations are minutes of work, the hand-
 * written constraints are hours, and the un-checkable ones are seconds.
 *
 * The model has no opinion about any citizen's eligibility and never appears on
 * a citizen-facing page. A clause still becomes decisive only when the reviewer
 * reading this page approves it.
 */
export function TriagePanel({
  summary,
  quickWinText,
  info,
}: {
  summary: TriageSummary;
  /** clause id → its text, for the "start here" list. */
  quickWinText: Record<string, string>;
  info: { model: string; macroF1: number; clauses: number; features: string };
}) {
  if (summary.total === 0) return null;

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line bg-surface/60 px-4 py-3">
        <h2 className="text-base font-semibold text-ink">Suggested order of work</h2>
        <p className="mt-1 text-sm text-muted">
          A gradient-boosting model predicts what each of the{' '}
          {summary.total.toLocaleString('en-IN')} unreviewed clauses will need, so the cheap ones can be
          cleared first. It is a worklist, not a verdict — nothing here decides anyone&rsquo;s
          eligibility.
        </p>
      </div>

      <div className="divide-y divide-line">
        {ORDER.map((cls) => {
          const n = summary.counts[cls];
          const pct = summary.total ? (n / summary.total) * 100 : 0;
          const meta = LABEL[cls];
          return (
            <div key={cls} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className={`text-sm font-semibold ${meta.tone}`}>{meta.title}</p>
                <p className="shrink-0 text-sm tabular-nums text-ink">
                  {n.toLocaleString('en-IN')}{' '}
                  <span className="text-xs text-muted">({pct.toFixed(0)}%)</span>
                </p>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line/60">
                <div className={`h-full ${meta.bar}`} style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">{meta.work}</p>
            </div>
          );
        })}
      </div>

      {summary.quickWins.length > 0 && (
        <div className="border-t border-line bg-brand-50/60 px-4 py-3">
          <p className="eyebrow text-brand">Start here</p>
          <p className="mt-1 text-xs text-muted">
            Most likely to be a quick confirmation. The prediction only orders the queue; read the clause
            before approving anything.
          </p>
          <ol className="mt-2.5 space-y-2">
            {summary.quickWins.map((q) => (
              <li key={q.id} className="flex gap-2.5">
                <span className="mt-0.5 shrink-0 rounded bg-paper px-1.5 py-0.5 font-mono text-[0.7rem] tabular-nums text-brand">
                  {(q.confidence * 100).toFixed(0)}%
                </span>
                <span className="min-w-0 text-sm leading-snug text-ink">
                  <span className="line-clamp-2">{quickWinText[q.id] ?? q.id}</span>
                  <span className="mt-0.5 block font-mono text-[0.7rem] text-muted">{q.id}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className="border-t border-line px-4 py-2.5 text-xs leading-relaxed text-muted">
        {info.model} · {info.features} · macro-F1 <strong>{info.macroF1.toFixed(3)}</strong> over{' '}
        {info.clauses.toLocaleString('en-IN')} clauses. Every prediction is out-of-fold — each clause
        was classified by a model that had not seen it. Labels come from the rule proposer, so this
        predicts what the proposer would say, not ground truth.
        {summary.unpredicted > 0 && (
          <>
            {' '}
            <span className="font-semibold text-maybe">
              {summary.unpredicted.toLocaleString('en-IN')} clauses have no prediction — the corpus is
              newer than the model. Re-run <code className="font-mono">python ml/predict_all.py</code>.
            </span>
          </>
        )}
      </p>
    </div>
  );
}
