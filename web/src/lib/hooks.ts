import { useEffect, useState } from 'react';

function useMedia(q: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia?.(q).matches ?? false);
  useEffect(() => {
    const m = window.matchMedia(q);
    const f = () => setOn(m.matches);
    f();
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [q]);
  return on;
}

export const useReduced = () => useMedia('(prefers-reduced-motion: reduce)');
export const useNarrow = () => useMedia('(max-width: 639px)');
