import { useCallback, useEffect, useState } from 'react';
import { api, isMock } from '@/lib/api';
import type { Me } from '@/lib/types';
import { navigate, usePath } from '@/router';
import { Legal } from '@/views/Legal';
import { SignedIn } from '@/views/SignedIn';
import { SignedOut } from '@/views/SignedOut';
import { preloadScene } from '@/views/Space';

function Home() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const check = useCallback(() => {
    api
      .me()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);
  useEffect(() => {
    preloadScene();
    check();
  }, [check]);
  if (me === undefined) return <div className="h-dvh" aria-busy="true" />;
  if (!me) return <SignedOut />;
  return <SignedIn me={me} onSignedOut={() => setMe(null)} />;
}

function MockSession({ on }: { on: boolean }) {
  useEffect(() => {
    if (import.meta.env.MODE === 'mock')
      void import('@/mock').then((m) => {
        m.signIn(on);
        navigate('/', true);
      });
  }, [on]);
  return null;
}

export function App() {
  const path = usePath();
  if (path === '/privacy') return <Legal page="privacy" />;
  if (path === '/terms') return <Legal page="terms" />;
  if (isMock && path === '/login') return <MockSession on />;
  if (isMock && path === '/logout') return <MockSession on={false} />;
  return <Home key={path} />;
}
