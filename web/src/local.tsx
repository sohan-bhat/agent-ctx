import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { api, type Me } from '@/lib/api';
import { enter, GONE } from '@/lib/local';
import { SignedIn } from '@/views/SignedIn';
import { preloadScene } from '@/views/Space';

enter();

function Local() {
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    preloadScene();
    api
      .me()
      .then((m) => (m ? setMe(m) : setFailed(true)))
      .catch(() => setFailed(true));
  }, [turn]);
  if (failed)
    return (
      <main className="grid h-dvh place-items-center px-5 text-center">
        <p role="status">{GONE}</p>
      </main>
    );
  if (!me) return <div className="h-dvh" aria-busy="true" />;
  return <SignedIn key={turn} me={me} onSignedOut={() => setTurn((n) => n + 1)} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Local />
  </StrictMode>,
);
