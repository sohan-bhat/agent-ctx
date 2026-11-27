import { StrictMode, useCallback, useEffect, useRef, useState, useSyncExternalStore, type WheelEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
const LEAD = 'Work started in Claude Code is continued in ';
const NAMES = ['Cursor', 'Codex', 'Gemini CLI', 'Claude desktop'];
const OPEN = [
  [8, 12],
  [13, 18],
];
const pct = (hours: number) => `${(hours / 24) * 100}%`;
const PILL = 'h-11 rounded-full px-5 text-[0.9375rem]';

const FAQ = [
  ['What does agent-ctx do?', 'One memory is shared by all of your coding agents, so work started in one agent is continued in the next agent without a new explanation.'],
  ['Which agents work with agent-ctx?', 'Claude Code comes first and is being tested now. Cursor, Codex, Gemini CLI and the Claude desktop app are built from the documents of each vendor and are tested next.'],
  ['Where is the memory kept?', 'The memory is one database file in the folder .agent-ctx in your home folder, and no account exists.'],
  ['What is active in the background?', 'Nothing is active while no agent is open. Each agent starts a small helper while that agent is open, and one hook is run at each prompt for a fraction of a second.'],
  ['What leaves my computer?', 'Nothing leaves your computer.'],
  ['Can my agents be tricked by a web page or a file through the memory?', 'Text from a web page or a file is stored as information and is delivered to an agent as quoted memory. Such text never becomes a rule unless you accept the rule yourself.'],
  ['How do I remove agent-ctx?', 'Every entry that was added is taken out with one command, and the memory file stays until you delete the folder.'],
  ['What does agent-ctx cost?', 'agent-ctx is free and open source under the MIT licence.'],
];

const DARK = '(prefers-color-scheme: dark)';
const system = window.matchMedia(DARK);
const scheme = new EventTarget();
const painted: string[] = [];
let choice: boolean | null = null;
const isDark = () => choice ?? system.matches;
Object.defineProperties(scheme, { matches: { get: isDark }, media: { value: DARK } });
system.addEventListener('change', () => scheme.dispatchEvent(new Event('change')));
const query = window.matchMedia.bind(window);
window.matchMedia = (q) => (q === DARK ? (scheme as unknown as MediaQueryList) : query(q));

function tokens(dark: boolean): [string, string][] {
  const out: [string, string][] = [];
  const take = (rule: CSSRule) => {
    if (!(rule instanceof CSSStyleRule) || rule.selectorText !== ':root') return;
    for (const name of rule.style) if (name.startsWith('--') || name === 'color-scheme') out.push([name, rule.style.getPropertyValue(name)]);
  };
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (!(rule instanceof CSSMediaRule)) take(rule);
        else if (dark && rule.conditionText.replace(/\s/g, '') === DARK.replace(/\s/g, '')) for (const inner of rule.cssRules) take(inner);
      }
    } catch {
      continue;
    }
  }
  return out;
}

function setTheme(dark: boolean) {
  const root = document.documentElement;
  for (const name of painted.splice(0)) root.style.removeProperty(name);
  choice = dark === system.matches ? null : dark;
  if (choice !== null)
    for (const [name, value] of tokens(choice)) {
      root.style.setProperty(name, value);
      painted.push(name);
    }
  scheme.dispatchEvent(new Event('change'));
}

function watch(f: () => void) {
  scheme.addEventListener('change', f);
  return () => scheme.removeEventListener('change', f);
}

function Top() {
  const dark = useSyncExternalStore(watch, isDark);
  return (
    <nav className="site-top" aria-label="Site">
      <a href={HOME} rel="noreferrer">
        GitHub
      </a>
      <Label htmlFor="site-theme" className="text-sm">
        Dark
      </Label>
      <Switch id="site-theme" checked={dark} onCheckedChange={setTheme} />
    </nav>
  );
}

function Typed() {
  const reduced = useReduced();
  const [at, setAt] = useState({ name: 0, shown: NAMES[0].length, back: false });
  useEffect(() => {
    if (reduced) return;
    const full = at.shown === NAMES[at.name].length;
    const id = setTimeout(
      () => {
        if (at.back) setAt(at.shown ? { ...at, shown: at.shown - 1 } : { name: (at.name + 1) % NAMES.length, shown: 0, back: false });
        else setAt(full ? { ...at, back: true } : { ...at, shown: at.shown + 1 });
      },
      at.back ? (at.shown ? 55 : 500) : full ? 2600 : 110,
    );
    return () => clearTimeout(id);
  }, [at, reduced]);
  return (
    <p className="site-typed" data-site="typed" data-room={`${LEAD}${NAMES[NAMES.length - 1]}`}>
      <span>
        {LEAD}
        <span className="sr-only">{NAMES[0]}.</span>
        <span aria-hidden data-site="agent">
          {reduced ? NAMES[0] : NAMES[at.name].slice(0, at.shown)}
        </span>
        <span className="site-caret" aria-hidden />
      </span>
    </p>
  );
}

function Action() {
  const [copied, setCopied] = useState(false);
  const home = (
    <a href={HOME} rel="noreferrer">
      View on GitHub
    </a>
  );
  if (!RELEASED)
    return (
      <>
        <div className="site-action" data-site="action">
          <Button asChild size="lg" className={PILL}>
            {home}
          </Button>
          <Button asChild variant="outline" size="lg" className={PILL}>
            <a href="#faq">Read the FAQ</a>
          </Button>
        </div>
        <p className="site-status" data-site="status">
          The first release is being tested.
        </p>
      </>
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
      <Button className="h-11 w-[5.5rem] rounded-full text-[0.9375rem]" aria-live="polite" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <Button asChild variant="outline" size="lg" className={PILL}>
        {home}
      </Button>
    </div>
  );
}

function Demo() {
  const reduced = useReduced();
  const frame = useRef<HTMLDivElement>(null);
  const [time, setTime] = useState(reduced ? DEMO_END : DEMO_START);
  const [seen, setSeen] = useState(false);
  const [stopped, setStopped] = useState(reduced);
  const idle = useRef({ held: false, open: false });
  useEffect(() => {
    const el = frame.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(([entry]) => setSeen(entry.intersectionRatio >= 0.4), { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  useEffect(() => {
    if (!seen || stopped) return;
    let id = 0;
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
      id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [seen, stopped]);
  useEffect(() => {
    if (time >= DEMO_END) setStopped(true);
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
    <div ref={frame} className="site-demo" data-site="demo" onWheelCapture={scroll}>
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
          setStopped(true);
          setTime(t);
        }}
        onHold={onHold}
        onPanel={onPanel}
      />
    </div>
  );
}

function Day() {
  return (
    <div className="site-day" data-site="day" role="img" aria-label="A background server is active through all 24 hours of a day, and agent-ctx is active only while an agent is open.">
      <p>A background server</p>
      <svg className="site-bar-server" data-site="bar" width="100%" height="14">
        <rect x="0" y="0" width="100%" height="100%" rx="3" />
      </svg>
      <p translate="no">agent-ctx</p>
      <svg className="site-bar-ours" data-site="bar" width="100%" height="14">
        <line x1="0" y1="50%" x2="100%" y2="50%" />
        {OPEN.map(([from, to]) => (
          <rect key={from} x={pct(from)} y="0" width={pct(to - from)} height="100%" rx="3" />
        ))}
      </svg>
    </div>
  );
}

function Site() {
  return (
    <div className="site">
      <a href="#space" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-sm focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">
        Skip to the demo
      </a>
      <Top />
      <main>
        <div className="site-column site-head" data-site="column">
          <h1 translate="no">agent-ctx</h1>
          <Typed />
          <p data-site="line">One memory is shared by every coding agent and stays on your own computer.</p>
          <Action />
        </div>
        <Demo />
        <section className="site-column site-faq" data-site="faq">
          <h2 id="faq">FAQ</h2>
          {FAQ.map(([question, answer], i) => (
            <div key={question}>
              <h3>{question}</h3>
              <p>{answer}</p>
              {i === 3 && <Day />}
            </div>
          ))}
        </section>
      </main>
      <footer className="site-foot">
        <p>MIT licence</p>
        <a href={HOME} rel="noreferrer" translate="no" className="num">
          github.com/{REPO}
        </a>
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
