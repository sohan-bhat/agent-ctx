import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { api, isMock } from '@/lib/api';
import type { Me } from '@/lib/types';
import { navigate, usePath } from '@/router';
import { SignedOut } from '@/views/SignedOut';
import { preloadScene } from '@/views/Space';

const loadSignedIn = () => import('@/views/SignedIn');
const SignedIn = lazy(() => loadSignedIn().then((m) => ({ default: m.SignedIn })));
const Legal = lazy(() => import('@/views/Legal').then((m) => ({ default: m.Legal })));
const blank = <div className="h-dvh" aria-busy="true" />;

function Home() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const check = useCallback(() => {
    api
      .me()
      .then((m) => {
        if (m) void loadSignedIn();
        setMe(m);
      })
      .catch(() => setMe(null));
  }, []);
  useEffect(() => {
    preloadScene();
    check();
  }, [check]);
  if (me === undefined) return blank;
  if (!me) return <SignedOut />;
  return (
    <Suspense fallback={blank}>
      <SignedIn me={me} onSignedOut={() => setMe(null)} />
    </Suspense>
  );
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
  if (path === '/privacy' || path === '/terms')
    return (
      <Suspense fallback={blank}>
        <Legal page={path === '/privacy' ? 'privacy' : 'terms'} />
      </Suspense>
    );
  if (isMock && path === '/login') return <MockSession on />;
  return <Home key={path} />;
}
