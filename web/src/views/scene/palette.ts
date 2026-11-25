import { useEffect, useState } from 'react';
import type { Kind } from '@/lib/model';

export interface Palette {
  dark: boolean;
  background: string;
  foreground: string;
  muted: string;
  ring: string;
  table: string;
  kinds: Record<Kind, string>;
}

const KEYS: Kind[] = ['system', 'memory', 'prompts', 'replies', 'tools', 'summary'];

function read(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    dark: document.documentElement.classList.contains('dark'),
    background: v('--background'),
    foreground: v('--foreground'),
    muted: v('--muted-foreground'),
    ring: v('--ring'),
    table: v('--table'),
    kinds: Object.fromEntries(KEYS.map((k) => [k, v(`--kind-${k}`)])) as Record<Kind, string>,
  };
}

export function usePalette(): Palette {
  const [p, setP] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setP(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return p;
}
