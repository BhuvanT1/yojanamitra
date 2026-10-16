'use client';

/**
 * The hero input.
 *
 * One large field, not a twenty-field form. A citizen who has to answer twenty
 * questions before seeing anything will leave; a citizen who types one sentence
 * and gets a result will correct the details afterwards, which is what the
 * "what we understood" panel is for.
 *
 * ---------------------------------------------------------------------------
 * Voice input
 *
 * The Web Speech API fails in a dozen ordinary ways and reports almost none of
 * them to the person holding the phone. Every one of those failures used to look
 * identical here — the button lit up, nothing was transcribed, and the citizen
 * had no idea whether they should speak louder, grant a permission, or give up.
 *
 * So the rules this component follows:
 *
 *   Never a silent failure. Every error code that is actually terminal becomes a
 *   sentence on screen telling the citizen what to do about it.
 *
 *   Never a stuck button. Any path out of `listening` clears the timers, detaches
 *   the recogniser, and resets the control — including unmount, including a
 *   recogniser that dies without firing `onend`.
 *
 *   Never an auto-search of something nobody said. The five-second countdown only
 *   runs after speech has actually been detected. Before that there is a longer,
 *   silent grace window which gives up without searching, because submitting
 *   text the citizen typed ten minutes ago because they tapped the microphone and
 *   then said nothing is not a feature.
 *
 *   Only HTTPS. Chrome exposes the constructor on an insecure origin and then
 *   refuses the microphone, so the button would be a trap. Secure context is part
 *   of the availability check, and the reason is shown rather than swallowed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Messages } from '@/i18n/messages';

interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onspeechend: (() => void) | null;
  onspeechstart: (() => void) | null;
  onnomatch: (() => void) | null;
}

type Ctor = new () => SpeechRecognitionLike;

function recogniser(): Ctor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: Ctor;
    webkitSpeechRecognition?: Ctor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/**
 * How long to keep listening after the citizen stops talking.
 *
 * Browsers end recognition after roughly two seconds of silence, which cuts
 * people off mid-thought — especially anyone describing their situation for the
 * first time, or speaking a language the recogniser handles less fluently. We
 * restart recognition automatically and only truly stop after this much
 * continuous silence, then search on the citizen's behalf.
 *
 * Five seconds is the number the project asked for. It is long enough to think
 * mid-sentence and short enough that nobody wonders whether the thing is stuck —
 * and the countdown on screen means the citizen can see it coming either way.
 */
const SILENCE_MS = 5000;

/**
 * How long to wait for the citizen to start speaking at all.
 *
 * Longer than the silence window on purpose: finding the words for "I am a
 * thirty-two-year-old widow with half an acre" takes a moment, and the penalty
 * for being impatient here is a search nobody asked for.
 */
const FIRST_WORD_MS = 12_000;

/** A hard ceiling so a forgotten open microphone does not run forever. */
const MAX_LISTEN_MS = 120_000;

/**
 * Chrome ends recognition every few seconds and we restart it. That is normal.
 * A recogniser that is failing to start, though, produces the same end-restart
 * loop at speed, so the restarts are counted and the loop is broken.
 */
const MAX_RESTARTS = 40;

/** Tick fast enough that the depleting bar looks continuous. */
const TICK_MS = 100;

export function HeroInput({
  t,
  locale,
  value,
  onChange,
  onSubmit,
  busy,
}: {
  t: Messages;
  locale: string;
  value: string;
  onChange: (v: string) => void;
  /** Optional argument carries the final transcript when speech triggered it. */
  onSubmit: (spoken?: string) => void;
  busy: boolean;
}) {
  const [listening, setListening] = useState(false);
  /** 'yes' | 'insecure' | 'no' — 'insecure' is worth explaining, 'no' is not. */
  const [voice, setVoice] = useState<'yes' | 'insecure' | 'no'>('no');
  const [interim, setInterim] = useState('');
  /** Milliseconds until the automatic search, or null when nothing is pending. */
  const [leftMs, setLeftMs] = useState<number | null>(null);
  /** A sentence the citizen can act on. Never a raw error code. */
  const [problem, setProblem] = useState<string | null>(null);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const silenceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const firstWordRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const maxRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tickRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  /** When the automatic search will fire, so the countdown and the timer agree. */
  const deadlineRef = useRef<number>(0);
  /** Set when WE stopped, so `onend` knows not to restart. */
  const stoppingRef = useRef(false);
  /** The authoritative transcript; `value` lags behind the last result event. */
  const transcriptRef = useRef('');
  /** Has the recogniser heard anything at all this session? */
  const heardRef = useRef(false);
  const restartsRef = useRef(0);
  /** Set once we have fallen back to en-IN after a language-not-supported. */
  const fellBackRef = useRef(false);

  useEffect(() => {
    if (!recogniser()) {
      setVoice('no');
      return;
    }
    // The constructor exists on http:// too, and then the microphone request is
    // refused. Treat that as unavailable-with-a-reason rather than offering a
    // button that cannot work.
    setVoice(window.isSecureContext ? 'yes' : 'insecure');
  }, []);

  // Grow with the text rather than forcing a scrollbar in a small box.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 132)}px`;
  }, [value]);

  const clearTimers = useCallback(() => {
    clearTimeout(silenceRef.current);
    clearTimeout(firstWordRef.current);
    clearTimeout(maxRef.current);
    clearInterval(tickRef.current);
    silenceRef.current = undefined;
    firstWordRef.current = undefined;
    maxRef.current = undefined;
    tickRef.current = undefined;
  }, []);

  /** Detach and abort, so a dying recogniser cannot call back into this tree. */
  const detach = useCallback(() => {
    const rec = recRef.current;
    recRef.current = null;
    if (!rec) return;
    rec.onresult = null;
    rec.onend = null;
    rec.onerror = null;
    rec.onspeechend = null;
    rec.onspeechstart = null;
    rec.onnomatch = null;
    try {
      rec.abort();
    } catch {
      /* already dead */
    }
  }, []);

  // Never leave the microphone open when the component goes away.
  useEffect(
    () => () => {
      stoppingRef.current = true;
      clearTimers();
      detach();
    },
    [clearTimers, detach],
  );

  const stopListening = useCallback(
    (submitAfter: boolean) => {
      stoppingRef.current = true;
      clearTimers();
      detach();
      setListening(false);
      setInterim('');
      setLeftMs(null);

      // Auto-search once speech is finished: the citizen has said their piece and
      // should not have to find a button afterwards. Read the transcript from the
      // ref, not from `value` — the last onresult may not have re-rendered yet.
      if (submitAfter) {
        const said = transcriptRef.current.trim();
        if (said.length > 0) onSubmit(said);
      }
    },
    [clearTimers, detach, onSubmit],
  );

  /** A terminal failure: stop everything and say what happened. */
  const fail = useCallback(
    (message: string) => {
      stoppingRef.current = true;
      clearTimers();
      detach();
      setListening(false);
      setInterim('');
      setLeftMs(null);
      setProblem(message);
    },
    [clearTimers, detach],
  );

  /**
   * (Re)start the five-second countdown.
   *
   * Called on every scrap of speech, so the clock only runs during actual
   * silence. The visible counter reads from the same deadline the timer uses, so
   * what the citizen sees cannot disagree with what is about to happen.
   */
  const armSilence = useCallback(() => {
    clearTimeout(silenceRef.current);
    clearTimeout(firstWordRef.current);
    clearInterval(tickRef.current);

    deadlineRef.current = Date.now() + SILENCE_MS;
    setLeftMs(SILENCE_MS);

    silenceRef.current = setTimeout(() => stopListening(true), SILENCE_MS);
    tickRef.current = setInterval(() => {
      const left = deadlineRef.current - Date.now();
      setLeftMs(left > 0 ? left : 0);
    }, TICK_MS);
  }, [stopListening]);

  /** The quiet window before the first word. No countdown, and no search. */
  const armFirstWord = useCallback(() => {
    clearTimeout(firstWordRef.current);
    setLeftMs(null);
    firstWordRef.current = setTimeout(() => {
      if (heardRef.current) return;
      fail(t.speechNotHeard);
    }, FIRST_WORD_MS);
  }, [fail, t.speechNotHeard]);

  /**
   * Build and start a recogniser.
   *
   * Returns false when `start()` threw, which is how a blocked microphone and an
   * already-running recogniser both present themselves.
   */
  const begin = useCallback((): boolean => {
    const Ctor = recogniser();
    if (!Ctor) return false;

    detach();
    const rec = new Ctor();

    // Ask for the locale the citizen chose, so Telugu speech is transcribed as
    // Telugu rather than mangled through an English model. If the browser has no
    // model for it we fall back once, rather than failing.
    rec.lang = fellBackRef.current ? 'en-IN' : locale === 'en' ? 'en-IN' : `${locale}-IN`;
    rec.continuous = true; // do not end at the first pause
    rec.interimResults = true; // show words as they are spoken
    rec.maxAlternatives = 1;

    // While someone is actually talking there is no countdown to show.
    rec.onspeechstart = () => {
      heardRef.current = true;
      clearTimeout(silenceRef.current);
      clearTimeout(firstWordRef.current);
      clearInterval(tickRef.current);
      setLeftMs(null);
    };

    rec.onresult = (e) => {
      heardRef.current = true;
      let finals = '';
      let pending = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        const said = r[0]?.transcript ?? '';
        if (r.isFinal) finals += said;
        else pending += said;
      }
      if (finals) {
        transcriptRef.current = `${transcriptRef.current} ${finals}`.replace(/\s+/g, ' ').trim();
        onChange(transcriptRef.current);
      }
      setInterim(pending);

      // Any speech at all resets the silence countdown.
      armSilence();
    };

    rec.onspeechend = () => armSilence();

    // No match is not a failure — the citizen said something the model could not
    // place. Treat it exactly like a pause.
    rec.onnomatch = () => {
      if (heardRef.current) armSilence();
    };

    rec.onerror = (e) => {
      switch (e.error) {
        // Ordinary during a pause. The timers already govern what happens next.
        case 'no-speech':
        case 'aborted':
          return;
        case 'not-allowed':
        case 'service-not-allowed':
          fail(t.speechBlocked);
          return;
        case 'audio-capture':
          fail(t.speechNoMic);
          return;
        case 'network':
          fail(t.speechNetwork);
          return;
        case 'language-not-supported':
        case 'bad-grammar':
          // Retry in English once; `onend` fires straight after this.
          if (!fellBackRef.current) {
            fellBackRef.current = true;
            return;
          }
          fail(t.speechFailed);
          return;
        default:
          fail(t.speechFailed);
      }
    };

    // Chrome ends recognition on its own after a short silence even when
    // `continuous` is set. Restart it unless we meant to stop, so a thinking
    // pause does not end the citizen's turn.
    rec.onend = () => {
      if (stoppingRef.current) return;
      restartsRef.current += 1;
      if (restartsRef.current > MAX_RESTARTS) {
        // Either the citizen has been going for a very long time, or the
        // recogniser is flapping. Keep whatever was heard.
        stopListening(heardRef.current);
        return;
      }
      if (!begin()) fail(t.speechFailed);
    };

    recRef.current = rec;
    try {
      rec.start();
      return true;
    } catch {
      detach();
      return false;
    }
  }, [armSilence, detach, fail, locale, onChange, stopListening, t.speechBlocked, t.speechFailed, t.speechNetwork, t.speechNoMic]);

  function toggleVoice() {
    if (listening) {
      stopListening(true);
      return;
    }

    setProblem(null);
    stoppingRef.current = false;
    heardRef.current = false;
    restartsRef.current = 0;
    fellBackRef.current = false;
    transcriptRef.current = value;

    if (!begin()) {
      // The overwhelmingly common cause, and the one with an action attached.
      fail(t.speechBlocked);
      return;
    }

    setListening(true);
    armFirstWord();
    maxRef.current = setTimeout(() => stopListening(true), MAX_LISTEN_MS);
  }

  const empty = value.trim().length === 0;
  const seconds = leftMs === null ? null : Math.ceil(leftMs / 1000);
  const pct = leftMs === null ? 100 : Math.max(0, Math.min(100, (leftMs / SILENCE_MS) * 100));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      aria-busy={busy}
    >
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor="situation" className="label">
          {t.inputLabel}
        </label>
        {!empty && !listening && (
          <button
            type="button"
            onClick={() => {
              onChange('');
              transcriptRef.current = '';
              taRef.current?.focus();
            }}
            className="rounded px-1 text-xs font-semibold text-muted underline underline-offset-2 hover:text-brand"
          >
            {t.clearInput}
          </button>
        )}
      </div>

      <div className="relative mt-2.5">
        <textarea
          id="situation"
          ref={taRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            // Keep the speech transcript in step with manual edits, or the next
            // recognised phrase would clobber what the citizen just typed.
            if (listening) transcriptRef.current = e.target.value;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit();
          }}
          placeholder={t.placeholder}
          rows={3}
          maxLength={2000}
          aria-describedby="situation-help"
          className={`field resize-none text-base leading-relaxed shadow-inset sm:text-lg ${
            listening ? 'border-no ring-4 ring-no/10' : ''
          }`}
        />
        {value.length > 1600 && (
          <span className="pointer-events-none absolute bottom-2.5 right-3 rounded bg-paper/90 px-1.5 text-xs tabular-nums text-muted">
            {value.length}/2000
          </span>
        )}
      </div>

      <p id="situation-help" className="sr-only">
        {t.autoSearchHint}
      </p>

      {/* ------------------------------------------------------- listening */}
      {listening && (
        <div
          role="status"
          aria-live="polite"
          className="mt-3 overflow-hidden rounded-2xl border border-no-line bg-no-bg"
        >
          <div className="flex items-start gap-3 px-3.5 py-3">
            {/* Five bars rather than one dot: motion that tracks nothing real is
                decoration, but "the microphone is open" is real and worth
                showing unmistakably. */}
            <span aria-hidden="true" className="mt-1 flex h-4 items-end gap-[3px]">
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className="w-[3px] origin-bottom rounded-full bg-no animate-wave"
                  style={{ height: '100%', animationDelay: `${i * 110}ms` }}
                />
              ))}
            </span>

            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="font-semibold text-no">{t.listening}</span>
                {seconds !== null && (
                  <span className="rounded-full bg-paper px-2 py-0.5 text-xs font-semibold text-no">
                    {t.speechCountdown} <span className="tabular-nums">{seconds}s</span>
                  </span>
                )}
              </p>
              {interim ? (
                <p className="mt-0.5 truncate text-sm italic text-ink-soft">{interim}</p>
              ) : (
                <p className="mt-0.5 text-xs text-muted">{t.autoSearchHint}</p>
              )}
            </div>
          </div>

          {/* The countdown, drawn rather than counted. Depletes only during real
              silence, so a citizen can see their pause being tolerated. */}
          <div className="h-1 w-full bg-no/10">
            <div
              aria-hidden="true"
              className="h-full bg-no transition-[width] duration-100 ease-linear"
              style={{ width: `${seconds === null ? 0 : pct}%` }}
            />
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- problem */}
      {problem && !listening && (
        <p
          role="alert"
          className="mt-3 flex items-start gap-2.5 rounded-2xl border border-maybe-line bg-maybe-bg px-3.5 py-3 text-sm text-ink"
        >
          <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-maybe" aria-hidden="true">
            <circle cx="10" cy="10" r="8.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M10 6v5.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="10" cy="14" r="1.05" fill="currentColor" />
          </svg>
          <span>{problem}</span>
        </p>
      )}

      {/* --------------------------------------------------------- actions */}
      <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
        <button type="submit" disabled={busy || empty} className="btn-primary sm:flex-1">
          {busy ? (
            <>
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
              />
              {t.searching}
            </>
          ) : (
            <>
              <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" aria-hidden="true">
                <circle cx="9" cy="9" r="6.2" stroke="currentColor" strokeWidth="2" />
                <path d="m13.6 13.6 3.4 3.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              {t.find}
            </>
          )}
        </button>

        {voice === 'yes' && (
          <button
            type="button"
            onClick={toggleVoice}
            aria-pressed={listening}
            className={
              listening
                ? 'btn border-no bg-no text-white hover:border-no-deep hover:bg-no-deep'
                : 'btn-secondary'
            }
          >
            {listening ? (
              <>
                <span aria-hidden="true" className="h-3.5 w-3.5 rounded-[3px] bg-current" />
                {t.stopSpeaking}
              </>
            ) : (
              <>
                <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" aria-hidden="true">
                  <rect x="7" y="2" width="6" height="9.5" rx="3" fill="currentColor" />
                  <path
                    d="M4.5 9.2a5.5 5.5 0 0 0 11 0M10 14.8V17.5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
                {t.listen}
              </>
            )}
          </button>
        )}
      </div>

      {voice === 'insecure' && <p className="mt-2.5 text-xs text-muted">{t.speechInsecure}</p>}
    </form>
  );
}
