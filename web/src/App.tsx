import { useEffect, useState } from 'react';
import { Moon, Sun } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Sessions } from '@/views/Sessions';
import { Session } from '@/views/Session';

type Theme = 'light' | 'dark';

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('claude-ctx-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {}
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function useRoute(): string {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const route = useRoute();
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const bg = getComputedStyle(document.body).backgroundColor;
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', bg);
    try {
      localStorage.setItem('claude-ctx-theme', theme);
    } catch {}
  }, [theme]);
  const m = route.match(/^#\/s\/([^?]+)/);
  const id = m ? decodeURIComponent(m[1]) : null;
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [id]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-30 focus:rounded-md focus:bg-kelp focus:px-3 focus:py-1.5 focus:text-kelp-ink" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>
          Skip to content
        </a>
        <header className="border-b bg-shelf">
          <div className="mx-auto flex h-14 max-w-[1240px] items-center justify-between px-4 md:px-8">
            <a href="#/" className="font-heading text-[1.35rem] font-extrabold tracking-[-0.03em] no-underline" aria-label="claude-ctx, all sessions">
              claude-ctx
            </a>
            <Button
              variant="ghost"
              size="icon"
              aria-label={theme === 'dark' ? 'Use the light theme' : 'Use the dark theme'}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <Sun weight="bold" /> : <Moon weight="bold" />}
            </Button>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto max-w-[1240px] px-4 pb-28 pt-8 outline-none md:px-8 md:pt-10">{id ? <Session id={id} /> : <Sessions />}</main>
      </div>
    </TooltipProvider>
  );
}
