import type { DraftSummary } from '@/proposals/predicted';

/**
 * Model-drafted constraint structure, on the reviewer's screen.
 *
 * The clauses in here are the ones that used to arrive as a blank form: no
 * pattern matched, so a reviewer had to read the sentence and work out from
 * scratch which profile fields it tested. Now a model names the likely fields
 * and operators, and the reviewer checks rather than composes.
 *
 * Every number on this panel is deliberately framed as a draft. A reviewer who
 * trusted these without reading the clause would be approving a guess, and an
 * approved guess is exactly what the rest of this project exists to prevent.
 */
export function DraftPanel({
  summary,
  clauseText,
  info,
}: {
  summary: DraftSummary;
  clauseText: Record<string, string>;
  info: { model: string; trainedOn: number; caveat: string; thresholds: { field: number } };
}) {
  if (summary.blank === 0) return null;

  const pct = summary.blank ? (summary.drafted / summary.blank) * 100 : 0;

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line bg-surface/60 px-4 py-3">
        <h2 className="text-base font-semibold text-ink">Model-drafted constraints</h2>
        <p className="mt-1 text-sm text-muted">
          These clauses matched no pattern, so they used to arrive with nothing drafted. A model
          trained on the {info.trainedOn.toLocaleString('en-IN')} clauses the proposer <em>could</em>{' '}
          parse predicts which profile fields each one tests.
        </p>
      </div>

      <div className="grid grid-cols-2 divide-x divide-line border-b border-line sm:grid-cols-4">
        {[
          { label: 'Arrived blank', value: summary.blank, tone: 'text-ink' },
          { label: 'Now drafted', value: summary.drafted, tone: 'text-yes' },
          { label: 'Strong (p ≥ 0.9)', value: summary.strong, tone: 'text-brand' },
          { label: 'Disqualifiers', value: summary.exclusions, tone: 'text-no' },
        ].map((c) => (
          <div key={c.label} className="px-4 py-3">
            <p className={`text-xl font-bold tabular-nums ${c.tone}`}>
              {c.value.toLocaleString('en-IN')}
            </p>
            <p className="mt-0.5 text-xs leading-snug text-muted">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="border-b border-line px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold text-ink">Coverage of the blank pile</p>
          <p className="text-sm font-semibold tabular-nums text-yes">{pct.toFixed(0)}%</p>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line/60">
          <div className="h-full bg-yes" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-muted">
          The rest stayed below the p ≥ {info.thresholds.field} bar and are left untouched — a wrong
          field sends a reviewer down the wrong path, which is worse than an empty draft.
        </p>
      </div>

      {summary.fieldTally.length > 0 && (
        <div className="border-b border-line px-4 py-3">
          <p className="eyebrow text-muted">Fields the drafts name</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {summary.fieldTally.map((f) => (
              <span
                key={f.field}
                className="rounded-full border border-line bg-surface/70 px-2.5 py-1 text-xs text-ink"
              >
                <span className="font-mono">{f.field}</span>{' '}
                <span className="tabular-nums text-muted">{f.clauses.toLocaleString('en-IN')}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {summary.top.length > 0 && (
        <div className="border-b border-line bg-brand-50/60 px-4 py-3">
          <p className="eyebrow text-brand">Strongest drafts</p>
          <p className="mt-1 text-xs text-muted">
            Check the clause against the predicted fields. The model proposes; you decide.
          </p>
          <ol className="mt-2.5 space-y-3">
            {summary.top.map((d) => (
              <li key={d.id}>
                <p className="line-clamp-2 text-sm leading-snug text-ink">{clauseText[d.id] ?? d.id}</p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="rounded bg-paper px-1.5 py-0.5 font-mono text-[0.7rem] tabular-nums text-brand">
                    {(d.confidence * 100).toFixed(0)}%
                  </span>
                  {Object.keys(d.fields).map((f) => (
                    <span
                      key={f}
                      className="rounded bg-paper px-1.5 py-0.5 font-mono text-[0.7rem] text-ink"
                    >
                      {f}
                    </span>
                  ))}
                  {d.ops.map((o) => (
                    <span key={o} className="font-mono text-[0.7rem] text-muted">
                      {o}
                    </span>
                  ))}
                  {d.exclusion && (
                    <span className="rounded bg-no-bg px-1.5 py-0.5 text-[0.7rem] font-bold text-no">
                      DISQUALIFIER
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className="px-4 py-2.5 text-xs leading-relaxed text-muted">
        {info.model}. <strong className="text-ink-soft">{info.caveat}</strong>
      </p>
    </div>
  );
}
