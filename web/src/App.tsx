import { useEffect, useState } from 'react';
import { Moon, Sun } from '@phosphor-icons/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Sessions } from '@/views/Sessions';
import { preloadScene, Session } from '@/views/Session';

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
  useEffect(preloadScene, []);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-h-dvh px-4 pb-24 pt-4 sm:px-8 md:px-12 md:pt-7">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-30 focus:rounded-sm focus:bg-primary focus:px-3 focus:py-1.5 focus:text-primary-foreground"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById('main')?.focus();
          }}
        >
          Skip to the content
        </a>
        <header className="flex h-8 max-w-[58rem] items-center justify-between">
          <a href="#/" translate="no" className="text-[0.9375rem] font-bold tracking-[-0.01em] no-underline" aria-label="claude-ctx, all sessions">
            claude-ctx
          </a>
          <button
            type="button"
            className="-mr-2 inline-flex size-8 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
            aria-label={theme === 'dark' ? 'Light theme' : 'Dark theme'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <Sun className="size-[1.05rem]" /> : <Moon className="size-[1.05rem]" />}
          </button>
        </header>
        <main id="main" tabIndex={-1} className="max-w-[58rem] pt-7 outline-none md:pt-10">
          {id ? <Session id={id} /> : <Sessions />}
        </main>
      </div>
    </TooltipProvider>
  );
}
