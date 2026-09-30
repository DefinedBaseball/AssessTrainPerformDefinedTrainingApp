/* ─────────────────────────────────────────────────────────────────────────
   Opening the player's Edit Profile modal from outside the profile page.

   The modal lives on the profile page, but the button that opens it lives in
   the global sidebar, so the two have to talk across a route boundary. There
   are two cases and they need different mechanisms:

     • Coming from ANOTHER route (/training, /settings, …) — the profile page
       mounts fresh, so it can read `?edit=1` off the URL on mount.

     • Already ON the profile page (any tab) — Next keeps the page mounted
       when only the query string changes, so nothing re-runs. This was the
       bug: the URL gained `?edit=1` and the modal never opened.

   Hence the event: the sidebar fires it on every click, the mounted profile
   page listens. Cross-route the event lands before the page exists and is
   harmlessly missed, which is exactly when the URL param does the work.

   The name is shared from here rather than written as a literal in both
   files, because a typo on one side would silently resurrect the same bug.
   ───────────────────────────────────────────────────────────────────────── */

export const PROFILE_EDIT_EVENT = 'profile:edit';

/** Ask the profile page to open its Edit Profile modal, if it is mounted. */
export function requestProfileEdit(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PROFILE_EDIT_EVENT));
}
