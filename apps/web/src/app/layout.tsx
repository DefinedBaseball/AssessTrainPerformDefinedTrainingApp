import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';
import { Sidebar } from '@/components/Sidebar';
import { ThemeProvider, themeBootstrapScript } from '@/lib/theme-context';

export const metadata: Metadata = {
  title: 'Player Development App',
  description: 'Baseball player development platform for coaches and players',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Bootstrap script — runs before React hydrates so the user's
            saved theme is applied to <html> before any markup paints,
            preventing a flash of the wrong palette. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>
            <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
              <Sidebar />
              <main className="app-main" style={{ flex: 1, overflowY: 'auto' }}>
                {children}
              </main>
            </div>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
