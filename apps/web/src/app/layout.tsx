import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';
import { AppShell } from '@/components/AppShell';
import { ThemeProvider, themeBootstrapScript } from '@/lib/theme-context';
import { UploadQueueProvider } from '@/lib/upload-queue';

export const metadata: Metadata = {
  title: 'Player Development App',
  description: 'Baseball player development platform for coaches and players',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /* suppressHydrationWarning: the theme bootstrap script intentionally sets
       data-theme on <html> before React hydrates (prevents a wrong-palette
       flash), which otherwise logs a dev-only "extra attributes" warning. */
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Bootstrap script — runs before React hydrates so the user's
            saved theme is applied to <html> before any markup paints,
            preventing a flash of the wrong palette. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>
            {/* Above the router so a background video upload survives closing
                the report modal and navigating around the app. */}
            <UploadQueueProvider>
              <AppShell>{children}</AppShell>
            </UploadQueueProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
