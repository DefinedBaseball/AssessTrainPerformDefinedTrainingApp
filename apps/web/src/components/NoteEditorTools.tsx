'use client';

/* Extra toolbar controls shared by the two rich notes editors (the in-tab
   NoteBlock editor in SwingTab and the report modal's RichTextEditor):

     TextSizeMenu     Size ▾ -- Small / Normal / Large / XL for the
                      highlighted text (or what is typed next)
     DictationButton  🎤 -- speak instead of type, using the browser's own
                      speech recognition (hidden where the browser has none)

   Both act on a contentEditable the caller passes in, and both keep the
   coach's place in it: the last caret / selection inside the editor is
   remembered, so tapping a toolbar control (which can take focus away on
   phones) still applies to the text that was highlighted. */

import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

type EditorRef = React.RefObject<HTMLDivElement | null>;

/* ── Remembering where the caret was ──────────────────────────────────── */

function useRememberedSelection(editorRef: EditorRef) {
  const saved = useRef<Range | null>(null);
  useEffect(() => {
    const onChange = () => {
      const el = editorRef.current;
      const sel = document.getSelection();
      if (!el || !sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (el.contains(range.commonAncestorContainer)) saved.current = range.cloneRange();
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, [editorRef]);

  /** Focus the editor with the caret / selection back where it was (or at
   *  the end if it was never inside). Returns the editor, or null. */
  return useCallback((): HTMLDivElement | null => {
    const el = editorRef.current;
    if (!el) return null;
    el.focus();
    const sel = document.getSelection();
    if (!sel) return el;
    const current = sel.rangeCount ? sel.getRangeAt(0) : null;
    if (current && el.contains(current.commonAncestorContainer)) return el;
    let range = saved.current;
    if (!range || !el.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    sel.removeAllRanges();
    sel.addRange(range);
    return el;
  }, [editorRef]);
}

/* ── Text size ─────────────────────────────────────────────────────────── */

export interface SizeOption { value: string; label: string }

/* What <font size="N"> renders as (the font[size] rules in globals.css),
   for previewing each option. Keep the two in step. */
const FONT_SIZE_EM: Record<string, string> = {
  '1': '0.75em', '2': '0.85em', '3': '1em', '4': '1.15em',
  '5': '1.35em', '6': '1.7em', '7': '2.1em',
};

export function TextSizeMenu({
  editorRef, options, onApplied, buttonStyle,
}: {
  editorRef: EditorRef;
  /** execCommand('fontSize') values 1–7 with their labels. */
  options: SizeOption[];
  /** Called after a size is applied (the caller saves the HTML). */
  onApplied: () => void;
  buttonStyle?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const restore = useRememberedSelection(editorRef);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  const apply = (value: string) => {
    const el = restore();
    if (!el) return;
    /* <font size> is the only form execCommand produces that every browser
       agrees on; the note sanitizer keeps it, so the size survives saving
       and shows on the read-only display too. */
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand('fontSize', false, value);
    setOpen(false);
    onApplied();
  };

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        aria-label="Text size"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Text size"
        /* mousedown, not click: keeps the editor's highlighted text selected. */
        onMouseDown={(e) => { e.preventDefault(); setOpen((o) => !o); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o); } }}
        style={{ ...buttonStyle, width: 'auto', padding: '0 8px', gap: 4, display: 'inline-flex', alignItems: 'center' }}
      >
        Size <span aria-hidden="true" style={{ fontSize: '0.7em', opacity: 0.7 }}>▾</span>
      </button>
      {open && (
        <span
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50,
            display: 'flex', flexDirection: 'column', minWidth: 120, padding: 4,
            background: 'var(--surface-bright, var(--surface, #1a1f2b))',
            border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: '0 10px 28px rgba(0,0,0,0.35)',
          }}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitem"
              onMouseDown={(e) => { e.preventDefault(); apply(o.value); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apply(o.value); } }}
              style={{
                textAlign: 'left', padding: '6px 10px', border: 'none', borderRadius: 5,
                background: 'transparent', color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(127,127,127,0.14)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              {/* Each option previews its own size. */}
              <span style={{ fontSize: FONT_SIZE_EM[o.value] ?? 'medium' }}>{o.label}</span>
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

/* ── Dictation ─────────────────────────────────────────────────────────── */

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/** Text immediately before the caret inside `el` (up to a few characters). */
function charsBeforeCaret(el: HTMLElement): string {
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount) return '';
  const r = sel.getRangeAt(0).cloneRange();
  r.selectNodeContents(el);
  r.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
  return r.toString().slice(-3);
}

export function DictationButton({
  editorRef, onInserted, buttonStyle,
}: {
  editorRef: EditorRef;
  /** Called after spoken text lands in the editor (the caller saves). */
  onInserted: () => void;
  buttonStyle?: React.CSSProperties;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const recRef = useRef<Recognition | null>(null);
  const restore = useRememberedSelection(editorRef);
  const insertedRef = useRef(onInserted);
  insertedRef.current = onInserted;

  /* Decided after mount so the server render and first paint agree. */
  useEffect(() => { setSupported(!!recognitionCtor()); }, []);
  useEffect(() => () => { recRef.current?.abort(); }, []);

  const insert = useCallback((spoken: string) => {
    const el = restore();
    if (!el) return;
    let text = spoken.trim();
    if (!text) return;
    const before = charsBeforeCaret(el);
    const atStart = before.trim() === '' && (el.textContent || '').trim() === '';
    const sentenceStart = atStart || /[.!?]\s*$/.test(before) || before === '';
    if (sentenceStart) text = text.charAt(0).toUpperCase() + text.slice(1);
    if (before && !/\s$/.test(before)) text = ' ' + text;
    document.execCommand('insertText', false, text);
    insertedRef.current();
  }, [restore]);

  const stop = () => { recRef.current?.stop(); };

  const start = () => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    setError('');
    setInterim('');
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
    rec.onresult = (e: any) => {
      let pending = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) insert(r[0].transcript);
        else pending += r[0].transcript;
      }
      setInterim(pending);
    };
    rec.onerror = (e: any) => {
      const code = e?.error;
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        setError('Microphone access is blocked. Allow the microphone for this site to dictate.');
      } else if (code === 'no-speech') {
        setError("Didn't catch anything. Tap the mic and try again.");
      } else if (code !== 'aborted') {
        setError('Dictation stopped. Tap the mic to try again.');
      }
    };
    rec.onend = () => { setListening(false); setInterim(''); recRef.current = null; };
    recRef.current = rec;
    restore();
    try {
      rec.start();
      setListening(true);
    } catch {
      setError('Dictation could not start. Try again.');
      recRef.current = null;
    }
  };

  if (!supported) return null;

  return (
    <>
      <button
        type="button"
        aria-label={listening ? 'Stop dictation' : 'Dictate notes'}
        aria-pressed={listening}
        title={listening ? 'Stop dictation' : 'Speak your notes'}
        onMouseDown={(e) => { e.preventDefault(); if (listening) stop(); else start(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (listening) stop(); else start(); } }}
        style={{
          ...buttonStyle,
          /* Override the whole border (not just borderColor): mixing the
             shorthand with a longhand that comes and goes makes React warn
             and can leave a stale border behind. */
          ...(listening
            ? { background: 'rgba(239,68,68,0.18)', border: '1px solid rgba(239,68,68,0.7)', color: '#ef4444' }
            : null),
        }}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor"
          strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" fill={listening ? 'currentColor' : 'none'} />
          <path d="M3 7.5a5 5 0 0 0 10 0" />
          <path d="M8 12.5v2" />
        </svg>
      </button>
      {(listening || error) && (
        <span
          role="status"
          style={{
            minWidth: 0, flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontSize: '0.8em', fontStyle: listening ? 'italic' : 'normal',
            color: error ? 'var(--red, #ef4444)' : 'var(--text-muted)',
          }}
        >
          {error || (interim ? `“${interim}”` : 'Listening… tap the mic again to stop')}
        </span>
      )}
    </>
  );
}
