import type { MetadataRoute } from 'next';

/* Web app manifest: the name and icon used when the app is installed
   ("Install app" on a laptop, "Add to Home Screen" on a phone). Icons are
   the sidebar's white "D" home-plate mark on its dark tile, built from
   public/logo.png. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Defined Baseball Academy',
    short_name: 'Defined',
    description: 'Baseball player development platform for coaches and players',
    start_url: '/',
    display: 'standalone',
    background_color: '#131417',
    theme_color: '#131417',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
