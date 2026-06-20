/**
 * RichTextEditor — lightweight contentEditable-based rich-text input.
 *
 * Toolbar provides:
 *   • Bold / Italic / Underline (toggles, mirror the current caret state)
 *   • Font size dropdown (Small / Normal / Large / XL)
 *
 * Storage format: HTML string (the editor's `innerHTML`). Callers persist
 * the HTML alongside any other report/post field and render it back with
 * `dangerouslySetInnerHTML` (or via the matching RichTextView helper).
 *
 * Why contentEditable + execCommand instead of a library:
 *   The notes fields across the app are small inline editors — pulling in
 *   Slate / TipTap / Quill is overkill (kilobytes + render-cycle weight).
 *   `document.execCommand` is technically deprecated but every modern
 *   browser still ships full support for bold/italic/underline/fontSize
 *   and the team has no plans to drop it. If/when it disappears, we swap
 *   the implementation behind this component's public API and every
 *   caller keeps working unchanged.
 */
'use client';

import { rem } from '@/lib/rem';
import { sanitizeHtml } from '@/lib/sanitize';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

const FONT_SIZES = [
  { label: 'Small',  value: '2' },
  { label: 'Normal', value: '3' },
  { label: 'Large',  value: '5' },
  { label: 'XL',     value: '6' },
];

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  /** Optional className applied to the outer wrapper for layout overrides. */
  className?: string;
  /** Disable interaction (read-only display). Toolbar hides in this mode. */
  disabled?: boolean;
}

export function RichTextEditor({
  value, onChange, placeholder, minHeight = 100, className, disabled,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState({ bold: false, italic: false, underline: false });
  const [isEmpty, setIsEmpty] = useState(!value || value === '<br>' || value === '');

  /* Sync the external `value` into the editor only when the editor
     isn't currently focused. Doing this on every keystroke would
     wipe the user's caret position because `innerHTML = ...` resets
     the selection. */
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const clean = sanitizeHtml(value);
    if (document.activeElement !== el && el.innerHTML !== clean) {
      el.innerHTML = clean;
    }
    setIsEmpty(!el.textContent || el.textContent.trim() === '');
  }, [value]);

  const refreshActive = () => {
    try {
      setActive({
        bold:      document.queryCommandState('bold'),
        italic:    document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
      });
    } catch {
      /* queryCommandState can throw in iframes / sandboxed contexts —
         we just leave the toolbar state as-is. */
    }
  };

  const exec = (command: string, val?: string) => {
    /* Re-focus the editor before issuing the command so the caret /
       selection lives inside the contentEditable rather than the
       toolbar button. Without this, clicking Bold from a blurred
       editor is a no-op. */
    const el = editorRef.current;
    if (el) el.focus();
    document.execCommand(command, false, val);
    if (el) {
      onChange(el.innerHTML);
      setIsEmpty(!el.textContent || el.textContent.trim() === '');
    }
    refreshActive();
  };

  const handleInput = () => {
    const el = editorRef.current;
    if (!el) return;
    onChange(el.innerHTML);
    setIsEmpty(!el.textContent || el.textContent.trim() === '');
  };

  /* Plain-text paste — strips formatting from copied content so the
     editor doesn't inherit weird font/colors from the source app.
     Coaches can re-apply formatting via the toolbar. */
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  };

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {!disabled && (
        <div style={toolbarRowStyle}>
          <ToolbarButton
            label="B"
            title="Bold (Ctrl+B)"
            onClick={() => exec('bold')}
            active={active.bold}
            extraStyle={{ fontWeight: 700 }}
          />
          <ToolbarButton
            label="I"
            title="Italic (Ctrl+I)"
            onClick={() => exec('italic')}
            active={active.italic}
            extraStyle={{ fontStyle: 'italic' }}
          />
          <ToolbarButton
            label="U"
            title="Underline (Ctrl+U)"
            onClick={() => exec('underline')}
            active={active.underline}
            extraStyle={{ textDecoration: 'underline' }}
          />
          <select
            aria-label="Font size"
            onChange={(e) => {
              if (e.target.value) exec('fontSize', e.target.value);
              e.target.value = '';
            }}
            onMouseDown={(e) => {
              /* prevent stealing focus from the editor when opening
                 the dropdown — keeps the current selection intact so
                 the fontSize command applies to the right text. */
              e.preventDefault();
              const el = editorRef.current;
              if (el) el.focus();
            }}
            defaultValue=""
            style={{ ...toolbarBtnStyle, padding: '4px 6px', cursor: 'pointer' }}
          >
            <option value="" disabled>Size</option>
            {FONT_SIZES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      )}

      <div style={{ position: 'relative' }}>
        <div
          ref={editorRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={handleInput}
          onPaste={handlePaste}
          onMouseUp={refreshActive}
          onKeyUp={refreshActive}
          onBlur={handleInput}
          style={{
            minHeight,
            padding: '10px 14px',
            borderRadius: 6,
            border: '1px solid var(--border, var(--border))',
            background: 'var(--surface, rgba(255,255,255,0.04))',
            color: 'var(--text, #ffffff)',
            fontSize: rem(14),
            fontFamily: 'inherit',
            outline: 'none',
            lineHeight: 1.5,
            cursor: disabled ? 'default' : 'text',
            whiteSpace: 'pre-wrap',
          }}
        />
        {/* Placeholder — contentEditable has no native placeholder
            support, so we render one as an absolutely-positioned
            muted text node shown only when the editor is empty.
            `pointer-events: none` so it doesn't intercept clicks
            into the editor. */}
        {isEmpty && placeholder && !disabled && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 10, left: 14,
              color: 'var(--text-muted, rgba(255,255,255,0.4))',
              fontSize: rem(14),
              pointerEvents: 'none',
              fontFamily: 'inherit',
            }}
          >
            {placeholder}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Inline toolbar button ──────────────────────────────────────────── */
function ToolbarButton({
  label, title, onClick, active, extraStyle,
}: {
  label: string;
  title: string;
  onClick: () => void;
  active: boolean;
  extraStyle?: CSSProperties;
}) {
  return (
    <button
      type="button"
      title={title}
      /* onMouseDown w/ preventDefault keeps the editor's selection
         alive when the button is clicked. Without it, the click
         steals focus and the format command applies to nothing. */
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      style={{
        ...toolbarBtnStyle,
        ...(extraStyle ?? {}),
        background: active ? 'rgba(255,255,255,0.12)' : toolbarBtnStyle.background,
        borderColor: active ? 'rgba(255,255,255,0.28)' : toolbarBtnStyle.borderColor,
      }}
    >
      {label}
    </button>
  );
}

/* ─── Shared styles ──────────────────────────────────────────────────── */
const toolbarRowStyle: CSSProperties = {
  display: 'flex',
  gap: 4,
  alignItems: 'center',
  flexWrap: 'wrap',
};

const toolbarBtnStyle: CSSProperties = {
  padding: '4px 8px',
  borderRadius: 4,
  border: '1px solid var(--border-light)',
  background: 'rgba(255,255,255,0.03)',
  color: 'var(--text, #ffffff)',
  fontSize: rem(12),
  cursor: 'pointer',
  fontFamily: 'inherit',
  minWidth: 28,
  lineHeight: 1.2,
};

/* ─── Render-only helper ─────────────────────────────────────────────────
   Use this when displaying saved rich-text content outside an editor
   (post body on the feed, notes on a PDF, etc.). Keeps the HTML
   sanitization concern in one place if/when we want to plug a
   sanitizer in. */
export function RichTextView({
  html, className, style,
}: {
  html: string | null | undefined;
  className?: string;
  style?: CSSProperties;
}) {
  if (!html) return null;
  return (
    <div
      className={className}
      style={{ whiteSpace: 'pre-wrap', ...style }}
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
    />
  );
}
