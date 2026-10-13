'use client';

/* Stops iPhone/iPad Safari zooming the page when a text box is tapped.

   Safari zooms into any input whose text is under 16px, and with the app's
   fluid root size almost every input on a phone is (see the login page's
   pt fix for the long version). Rather than resize every field in the app,
   this adds maximum-scale=1 to the viewport -- on iOS only. Safari ignores
   that value for the user's own pinch-zoom (iOS 10+), so pinching still
   works; it only blocks the automatic focus zoom. Android doesn't auto-zoom
   on focus but DOES honour maximum-scale for pinching, so it is left alone.

   Next.js rewrites the viewport tag on every page change, which wiped the
   setting after the first page (why Training still zoomed). A watcher on
   <head> puts it back whenever that happens. */

import { useEffect } from 'react';

export function IosInputZoomFix() {
  useEffect(() => {
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS reports as a Mac
    if (!isIOS) return;
    const apply = () => {
      document.querySelectorAll<HTMLMetaElement>('meta[name="viewport"]').forEach((meta) => {
        if (!/maximum-scale/.test(meta.content)) meta.content = `${meta.content}, maximum-scale=1`;
      });
    };
    apply();
    const watcher = new MutationObserver(apply);
    watcher.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['content'] });
    return () => watcher.disconnect();
  }, []);
  return null;
}
