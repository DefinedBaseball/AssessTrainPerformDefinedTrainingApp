import DOMPurify from 'dompurify';

/**
 * Sanitize stored rich-text HTML before it is turned into live DOM — either
 * rendered via `dangerouslySetInnerHTML` or loaded into a contentEditable
 * surface (`el.innerHTML = ...`). Strips scripts, event handlers (e.g.
 * `<img onerror>`), and other XSS vectors while preserving the safe
 * formatting our notes/posts use: bold / italic / underline, font sizes,
 * lists, line breaks, and inline color/size styles.
 *
 * Notes are authored by coaches and viewed by coaches, admins, and players,
 * so an unsanitized payload in a saved note is a stored-XSS vector. Running
 * this at every DOM sink neutralizes both new and already-stored content.
 *
 * Runs on the CLIENT, where the HTML actually hits the DOM (and where a script
 * would execute). During SSR / static prerender there is no `window`, so we
 * return empty rather than emit HTML — note/post content is auth-gated and
 * loaded client-side, so it renders (sanitized) after hydration.
 */
/** True for a note with no visible text: empty, or only tags / &nbsp; /
 *  whitespace (what a cleared rich-text box leaves behind, e.g. "<br>"). */
export function isBlankNoteHtml(html: string | null | undefined): boolean {
  if (!html) return true;
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim() === '';
}

export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return '';
  if (typeof window === 'undefined') return '';
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
