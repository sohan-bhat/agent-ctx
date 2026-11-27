import { StrictMode, useCallback, useEffect, useRef, useState, type WheelEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUpRightIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { REPO } from '@/agents';
import { DEMO_AGENTS, DEMO_END, DEMO_ITEMS, DEMO_PROJECTS, DEMO_READS, DEMO_START } from '@/demo';
import { useReduced } from '@/lib/utils';
import { Space } from '@/views/Space';
import './index.css';
import './site.css';

const RELEASED = import.meta.env.VITE_RELEASED === '1';
const HOME = `https://github.com/${REPO}`;
const INSTALL = `npx -y github:${REPO}`;
const RATE = (DEMO_END - DEMO_START) / 30_000;
const AGENTS = DEMO_AGENTS.map((a) => a.label);
const NONE = new Set<string>();
const OPEN = [
  [8, 12],
  [13, 18],
];
const HOURS = OPEN.reduce((sum, [from, to]) => sum + to - from, 0);
const TICKS = [0, 6, 12, 18, 24];
const pct = (hours: number) => `${(hours / 24) * 100}%`;
const LINK = 'underline decoration-foreground/35 underline-offset-4 transition-colors duration-150 hover:decoration-foreground';

function Demo() {
  const reduced = useReduced();
  const [time, setTime] = useState(reduced ? DEMO_END : DEMO_START);
  const [playing, setPlaying] = useState(!reduced);
  const idle = useRef({ held: false, open: false });
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    let due = 0;
    const step = (now: number) => {
      due += idle.current.held || idle.current.open ? 0 : Math.min(100, now - last);
      last = now;
      if (due >= 33) {
        const by = due * RATE;
        due = 0;
        setTime((t) => Math.min(DEMO_END, t + by));
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  useEffect(() => {
    if (time >= DEMO_END) setPlaying(false);
  }, [time]);
  const onHold = useCallback((held: boolean) => {
    idle.current.held = held;
  }, []);
  const onPanel = useCallback((open: boolean) => {
    idle.current.open = open;
  }, []);
  const scroll = (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
  };
  return (
    <div className="site-demo" onWheelCapture={scroll}>
      <Space
        projects={DEMO_PROJECTS}
        agents={AGENTS}
        items={DEMO_ITEMS}
        reads={DEMO_READS}
        queue={NONE}
        start={DEMO_START}
        end={DEMO_END}
        time={time}
        clockOnly
        segments={false}
        label="Demo of the shared space, one day of work by three agents"
        onTime={(t) => {
          setPlaying(false);
          setTime(t);
        }}
        onHold={onHold}
        onPanel={onPanel}
        aside={<span className="num pointer-events-none absolute right-0 top-0 text-xs">demo</span>}
      />
    </div>
  );
}

function Action() {
  const [copied, setCopied] = useState(false);
  if (!RELEASED)
    return (
      <div className="site-action site-action-link" data-site="action">
        <Button asChild size="lg" className="site-pill h-11 rounded-full px-5 text-[0.9375rem]">
          <a href={HOME} rel="noreferrer">
            Code on GitHub
            <ArrowUpRightIcon weight="bold" aria-hidden />
          </a>
        </Button>
        <p data-site="status">The first release is being tested.</p>
      </div>
    );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="site-action" data-site="action">
      <code translate="no" data-site="install" className="site-install num select-all">
        {INSTALL}
      </code>
      <Button className="site-pill h-11 w-[5.5rem] rounded-full text-[0.9375rem]" aria-live="polite" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

function Day() {
  return (
    <div className="site-day" data-site="day" role="img" aria-label={`Across one day of 24 hours a background server is active for all 24 hours, and agent-ctx is active for ${HOURS} hours, only while an agent is open`}>
      <p className="site-bar-name">
        <span>A background server</span>
        <span className="num">24 hours</span>
      </p>
      <svg className="site-bar site-bar-server" data-site="bar" width="100%" height="18">
        <rect x="0" y="0" width="100%" height="100%" rx="3" />
      </svg>
      <p className="site-bar-name">
        <span translate="no">agent-ctx</span>
        <span className="num">{HOURS} hours</span>
      </p>
      <svg className="site-bar site-bar-ours" data-site="bar" width="100%" height="18">
        <line x1="0" y1="50%" x2="100%" y2="50%" />
        {OPEN.map(([from, to]) => (
          <rect key={from} x={pct(from)} y="0" width={pct(to - from)} height="100%" rx="3" />
        ))}
      </svg>
      <svg className="site-ticks" width="100%" height="8">
        {TICKS.map((h) => (
          <line key={h} x1={pct(h)} y1="0" x2={pct(h)} y2="100%" />
        ))}
      </svg>
      <p className="site-hours num">
        {TICKS.map((h) => (
          <span key={h} style={{ left: pct(h) }}>
            {String(h).padStart(2, '0')}:00
          </span>
        ))}
      </p>
    </div>
  );
}

function Site() {
  return (
    <div className="site">
      <a href="#space" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-sm focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">
        Skip to the demo
      </a>
      <main>
        <section className="site-first">
          <p className="site-wordmark" data-site="wordmark" translate="no">
            agent-ctx
          </p>
          <div className="site-intro">
            <div className="site-say">
              <h1>One memory shared by your coding agents</h1>
              <p className="site-line" data-site="line">
                Work started in Claude Code is continued in Cursor or Codex without explaining anything again.
              </p>
            </div>
            <Action />
          </div>
          <Demo />
        </section>

        <section className="site-part" data-site="part">
          <h2>How work is passed from one agent to the next</h2>
          <ol className="site-steps" data-site="steps">
            <li>
              <span className="num" aria-hidden>
                1
              </span>
              <p>Claude Code works on a task, and the goal, the decisions and the changed files are saved as a short card.</p>
            </li>
            <li>
              <span className="num" aria-hidden>
                2
              </span>
              <p>You open Cursor or Codex in the same project.</p>
            </li>
            <li>
              <span className="num" aria-hidden>
                3
              </span>
              <p>The second agent reads the saved cards at the start and continues the work.</p>
            </li>
          </ol>
        </section>

        <section className="site-part" data-site="part">
          <h2>What is active on your computer</h2>
          <Day />
          <dl className="site-rows" data-site="rows">
            <div>
              <dt>No agent open</dt>
              <dd>Nothing from agent-ctx is running.</dd>
            </div>
            <div>
              <dt>An agent is open</dt>
              <dd>One small process is started by that agent and remains only while that agent is open.</dd>
            </div>
            <div>
              <dt>Each prompt</dt>
              <dd>One short command is run to save and fetch memory, and that command is over within a moment.</dd>
            </div>
            <div>
              <dt>The memory page</dt>
              <dd>The page is served only while you have the page open.</dd>
            </div>
          </dl>
        </section>

        <section className="site-part site-keep" data-site="part">
          <div>
            <h2>What stays with you</h2>
            <p>The memory is one small database file on your own computer, with no server, no account and no keys.</p>
          </div>
          <p className="site-file num" translate="no">
            ~/.agent-ctx/<b>memory.db</b>
          </p>
        </section>
      </main>
      <footer className="site-foot">
        <a href={HOME} rel="noreferrer" translate="no" className={`num ${LINK}`}>
          github.com/{REPO}
        </a>
        <p>MIT licence</p>
        <p>No cookie is set by this page and nothing is loaded from another host.</p>
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Site />
  </StrictMode>,
);
