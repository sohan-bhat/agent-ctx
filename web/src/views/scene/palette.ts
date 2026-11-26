import { useEffect, useState } from 'react';

export interface Palette {
  dark: boolean;
  background: string;
  foreground: string;
  muted: string;
  ring: string;
  table: string;
  agents: string[];
}

const DARK = '(prefers-color-scheme: dark)';

function read(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    dark: window.matchMedia?.(DARK).matches ?? false,
    background: v('--background'),
    foreground: v('--foreground'),
    muted: v('--muted-foreground'),
    ring: v('--ring'),
    table: v('--table'),
    agents: Array.from({ length: 8 }, (_, i) => v(`--agent-${i + 1}`)),
  };
}

export function agentColor(p: Palette, slot: number): string {
  return slot < 0 || slot >= p.agents.length ? p.muted : p.agents[slot];
}

export function usePalette(): Palette {
  const [p, setP] = useState(read);
  useEffect(() => {
    const m = window.matchMedia(DARK);
    const on = () => setP(read());
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return p;
}
