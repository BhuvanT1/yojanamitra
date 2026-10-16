'use client';

/**
 * "What we understood about you."
 *
 * Two jobs. It shows the citizen exactly what the system inferred and the words
 * it inferred it from — so a wrong reading is visible rather than buried in a
 * result they do not understand. And it lets them fix it, which re-runs the
 * match immediately.
 *
 * Every value shows its evidence. That is the whole argument for extracting from
 * the original text: "we think you are a farmer" is unfalsifiable, but "we think
 * you are a farmer because you wrote 'రైతుని'" is something a citizen can agree
 * or disagree with.
 *
 * The layout stacks label over value rather than sitting them side by side: this
 * panel lives in a narrow rail beside the results on a wide screen, and a
 * two-column row inside a 21rem column wraps into nonsense.
 */

import { useState } from 'react';
import type { Profile } from '@/domain/profile';
import { fieldLabel, type Messages } from '@/i18n/messages';

/**
 * Order matters: the fields a citizen is most likely to have got wrong, and that
 * most schemes test, come first.
 *
 * `occupation` and `special_categories` are multi-valued and were initially left
 * out of this list. That was a real defect — for the Telugu persona ("నేను
 * రైతుని") occupation is the only field extracted, so the panel showed the
 * citizen nothing it had understood and gave them no way to correct the one
 * thing that mattered.
 */
const EDITABLE = [
  'occupation',
  'age',
  'annual_income_inr',
  'land_acres',
  'state',
  'residence',
  'gender',
  'category',
  'education_stage',
  'special_categories',
] as const;

/** Fields whose value is a list; corrections are split on commas. */
const MULTI = new Set<string>(['occupation', 'special_categories']);

const CHOICES: Record<string, string[]> = {
  residence: ['rural', 'urban'],
  gender: ['female', 'male', 'transgender'],
  category: ['general', 'obc', 'sc', 'st', 'ews'],
};

const NUMERIC = new Set<string>(['age', 'annual_income_inr', 'land_acres']);

function display(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x).replace(/_/g, ' ')).join(', ');
  if (typeof v === 'number') return v.toLocaleString('en-IN');
  return String(v).replace(/_/g, ' ');
}

export function UnderstoodPanel({
  t,
  locale,
  profile,
  unknownFields,
  onCorrect,
}: {
  t: Messages;
  locale: string;
  profile: Profile;
  unknownFields: string[];
  onCorrect: (field: string, value: unknown) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const rows = EDITABLE.map((f) => ({
    field: f,
    value: (
      profile as unknown as Record<
        string,
        { value: unknown; confidence: number; evidence: string[]; origin: string } | undefined
      >
    )[f],
  }));

  const knownCount = rows.filter((r) => r.value !== undefined).length;

  function startEdit(field: string, current: unknown) {
    setEditing(field);
    setDraft(current === undefined ? '' : Array.isArray(current) ? current.join(', ') : String(current));
  }

  function commit(field: string) {
    const raw = draft.trim();
    if (raw === '') {
      setEditing(null);
      return;
    }
    let value: unknown;
    if (NUMERIC.has(field)) value = Number(raw.replace(/[, ]/g, ''));
    else if (MULTI.has(field)) {
      value = raw
        .toLowerCase()
        .split(',')
        .map((s) => s.trim().replace(/\s+/g, '_'))
        .filter(Boolean);
    } else value = raw.toLowerCase();

    onCorrect(field, value);
    setEditing(null);
  }

  return (
    <section aria-labelledby="understood-h" className="card overflow-hidden">
      <div className="border-b border-line bg-surface/60 px-4 py-3">
        <h2 id="understood-h" className="flex items-center gap-2 text-[0.95rem] font-bold text-ink">
          <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-brand" fill="none" aria-hidden="true">
            <rect x="3.5" y="2.8" width="13" height="14.4" rx="2.4" stroke="currentColor" strokeWidth="1.6" />
            <path d="M7 7.5h6M7 10.5h6M7 13.5h3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          {t.understood}
          <span className="ml-auto rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-brand">
            {knownCount}
          </span>
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">{t.understoodHelp}</p>
      </div>

      <dl className="divide-y divide-line px-4">
        {rows.map(({ field, value }) => {
          const known = value !== undefined;
          const isEditing = editing === field;

          return (
            <div key={field} className="py-2.5">
              {isEditing ? (
                <>
                  <dt className="eyebrow text-muted">{fieldLabel(locale, field)}</dt>
                  <dd className="mt-1.5">
                    {CHOICES[field] ? (
                      <select
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        aria-label={fieldLabel(locale, field)}
                        className="field py-2 text-sm"
                      >
                        <option value="">—</option>
                        {CHOICES[field]!.map((c) => (
                          <option key={c} value={c}>
                            {c.replace(/_/g, ' ')}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commit(field);
                          if (e.key === 'Escape') setEditing(null);
                        }}
                        inputMode={NUMERIC.has(field) ? 'decimal' : 'text'}
                        aria-label={fieldLabel(locale, field)}
                        className="field py-2 text-sm"
                      />
                    )}
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={() => commit(field)} className="btn-primary btn-sm flex-1">
                        {t.save}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="btn-secondary btn-sm"
                      >
                        {t.cancel}
                      </button>
                    </div>
                  </dd>
                </>
              ) : (
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <dt className="eyebrow text-muted">{fieldLabel(locale, field)}</dt>
                    <dd className="mt-0.5">
                      <span
                        className={
                          known ? 'text-[0.95rem] font-semibold text-ink' : 'text-sm italic text-muted'
                        }
                      >
                        {known ? display(value!.value) : t.notStated}
                      </span>

                      {known && value!.origin === 'user_corrected' && (
                        <span className="ml-1.5 rounded bg-brand-50 px-1.5 py-0.5 text-[0.7rem] font-semibold text-brand">
                          you told us
                        </span>
                      )}
                      {known && value!.origin === 'extracted' && value!.confidence < 0.7 && (
                        <span className="ml-1.5 rounded bg-maybe-bg px-1.5 py-0.5 text-[0.7rem] font-semibold text-maybe">
                          unsure
                        </span>
                      )}

                      {known && value!.origin === 'extracted' && value!.evidence.length > 0 && (
                        <span className="mt-0.5 block truncate text-xs italic text-muted">
                          “{value!.evidence.join('”, “')}”
                        </span>
                      )}
                    </dd>
                  </div>

                  <button
                    type="button"
                    onClick={() => startEdit(field, value?.value)}
                    className="tap -mr-2 shrink-0 rounded-lg px-2 text-sm font-semibold text-brand hover:bg-brand-50"
                  >
                    {t.edit}
                    <span className="sr-only"> {fieldLabel(locale, field)}</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </dl>

      {profile.dependents.length > 0 && (
        <div className="border-t border-line px-4 py-3">
          <p className="eyebrow text-muted">{fieldLabel(locale, 'dependents')}</p>
          {profile.dependents.map((d) => (
            <p key={d.id} className="mt-1 text-sm text-ink">
              <span className="font-semibold">{display(d.relation?.value ?? 'family member')}</span>
              {d.age && <> · {display(d.age.value)}</>}
              {d.education_stage && <> · {display(d.education_stage.value)}</>}
              {d.gender && <> · {display(d.gender.value)}</>}
            </p>
          ))}
        </div>
      )}

      {unknownFields.length > 0 && (
        <p className="border-t border-line bg-surface/60 px-4 py-3 text-xs leading-relaxed text-muted">
          {t.tellUs} {unknownFields.map((f) => fieldLabel(locale, f)).join(', ')}.
        </p>
      )}
    </section>
  );
}
