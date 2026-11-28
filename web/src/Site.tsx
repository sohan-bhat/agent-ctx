import {
  type CSSProperties,
  Fragment,
  StrictMode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type WheelEvent,
} from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { REPO } from "@/agents";
import {
  DEMO_AGENTS,
  DEMO_END,
  DEMO_ITEMS,
  DEMO_PROJECTS,
  DEMO_READS,
  DEMO_START,
} from "@/demo";
import { useReduced } from "@/lib/utils";
import { Space } from "@/views/Space";
import "./index.css";
import "./site.css";

const RELEASED = import.meta.env.VITE_RELEASED === "1";
const HOME = `https://github.com/${REPO}`;
const INSTALL =
  "Follow https://sohanbhat.me/agent-ctx/setup.md";
const RATE = (DEMO_END - DEMO_START) / 30_000;
const AGENTS = DEMO_AGENTS.map((a) => a.label);
const NONE = new Set<string>();
const LOGO = [
  "M0 0L53.75 0L53.75 32.25L32.25 32.25L32.25 139.75L53.75 139.75L53.75 172L0 172Z",
  "M64.5 64.5L107.5 64.5L107.5 107.5L64.5 107.5Z",
  "M86 0L131.608 0L217.608 86L131.608 172L86 172L172 86Z",
  "M319.93 131.83Q302.14 131.83 292.13 123.28Q282.11 114.72 282.11 100.55Q282.11 85.79 292.51 77.75Q302.9 69.71 322.28 69.71L350.58 69.71L350.58 65.88Q350.58 50.29 331.62 50.29Q315.16 50.29 311.64 61.69L283.6 61.69Q286.92 45.12 299.13 36.56Q311.34 28 331.56 28Q353.99 28 365.8 38.03Q377.62 48.06 377.62 67.23L377.62 102.13L390.88 102.13L390.88 130L362.35 130L362.35 113.6L355.35 113.6Q350.18 122.39 341.58 127.11Q332.97 131.83 319.93 131.83ZM324.17 110.43Q331.85 110.43 337.81 107.69Q343.76 104.95 347.17 100.23Q350.58 95.51 350.58 89.73L350.58 88.43L323.58 88.43Q309.1 88.43 309.1 99.18Q309.1 104.55 313.11 107.49Q317.12 110.43 324.17 110.43Z",
  "M453.37 172Q430.68 172 416.55 162.87Q402.41 153.74 399.8 137.48L429.62 137.48Q433.59 149.65 452.39 149.65Q465.25 149.65 472.05 143.78Q478.86 137.91 478.86 127.02L478.86 113.8L478.02 113.8Q473.49 121.82 465.68 125.91Q457.87 130 446.85 130Q432.8 130 422.37 123.75Q411.94 117.5 406.2 106.01Q400.46 94.53 400.46 79Q400.46 55.64 413.34 41.82Q426.22 28 448.86 28Q461.42 28 470.41 32.82Q479.4 37.65 484.68 46.4L491.68 46.4L491.68 30L520.22 30L520.22 57.87L506.28 57.87L506.28 127.21Q506.28 148.63 492.57 160.32Q478.86 172 453.37 172ZM453.88 105.41Q465.19 105.41 471.6 99.21Q478.02 93 478.02 82.19L478.02 75.53Q478.02 64.86 471.53 58.72Q465.05 52.59 453.88 52.59Q441.91 52.59 435.32 59.55Q428.73 66.51 428.73 79.14Q428.73 91.77 435.32 98.59Q441.91 105.41 453.88 105.41Z",
  "M582.23 132Q565.92 132 553.88 125.58Q541.85 119.17 535.33 107.4Q528.82 95.64 528.82 79.67Q528.82 63.69 535.19 52.11Q541.57 40.53 553.37 34.26Q565.16 28 581.14 28Q596.85 28 608.16 34.03Q619.48 40.06 625.51 51.26Q631.54 62.46 631.54 78.05L631.54 87.43L556 87.43Q557.64 98.3 564.33 103.98Q571.02 109.65 582.06 109.65Q590.66 109.65 595.72 106.74Q600.78 103.82 602.92 97.65L631.24 97.65Q627.96 113.79 615.02 122.9Q602.08 132 582.23 132ZM556.55 68.71L604.47 68.71Q603.02 59.55 597.14 54.92Q591.26 50.29 581.26 50.29Q571.4 50.29 565.07 54.99Q558.74 59.69 556.55 68.71Z",
  "M654.07 130L654.07 57.87L640.14 57.87L640.14 30L668.67 30L668.67 46.4L675.67 46.4Q681.51 37.79 690.31 32.98Q699.12 28.17 712.46 28.17Q733.4 28.17 744.77 39.59Q756.15 51.01 756.15 70.18L756.15 130L727.88 130L727.88 75.59Q727.88 64.65 722.09 58.98Q716.3 53.31 705.11 53.31Q693.94 53.31 688.14 58.98Q682.34 64.65 682.34 75.59L682.34 130L654.07 130Z",
  "M808.2 130Q797.28 130 791.26 124.46Q785.24 118.91 785.24 107.55L785.24 52.08L768.18 52.08L768.18 30L785.55 30L785.55 0L813.2 0L813.2 30L836.06 30L836.06 52.08L813.51 52.08L813.51 107.87L838.44 107.87L838.44 130L808.2 130Z",
  "M853.442 68.013L903.442 68.013L903.442 91.987L853.442 91.987Z",
  "M970.91 132Q955.32 132 943.53 125.58Q931.73 119.17 925.09 107.5Q918.44 95.83 918.44 80Q918.44 64.17 925 52.5Q931.56 40.83 943.43 34.42Q955.3 28 970.91 28Q990.84 28 1003.75 38.08Q1016.66 48.16 1019.85 65.69L991.53 65.69Q989.37 59.37 984.18 55.98Q978.99 52.59 970.91 52.59Q960.06 52.59 953.39 59.73Q946.71 66.87 946.71 80Q946.71 93.1 953.46 100.26Q960.2 107.41 970.91 107.41Q988.21 107.41 992.06 92.78L1020.38 92.78Q1017.5 111.15 1004.63 121.57Q991.76 132 970.91 132Z",
  "M1063.49 130Q1052.57 130 1046.55 124.46Q1040.54 118.91 1040.54 107.55L1040.54 52.08L1023.47 52.08L1023.47 30L1040.84 30L1040.84 0L1068.5 0L1068.5 30L1091.35 30L1091.35 52.08L1068.8 52.08L1068.8 107.87L1093.74 107.87L1093.74 130L1063.49 130Z",
  "M1099.8 130L1138.8 78.81L1101.8 30L1133.42 30L1154.93 58.87L1176.72 30L1208 30L1171.15 78.81L1210 130L1178.42 130L1154.85 98.38L1131.14 130L1099.8 130Z",
];
const OPEN = "Your context follows you";
const LEADS = ["from", "to"];
const TAIL = ".";
const NAMES = [
  "Claude Code",
  "Cursor",
  "Codex",
  "Antigravity",
  "Grok Build",
  "Muse Code",
  "Claude desktop",
];
const START = [0, 1].map((name) => ({
  name,
  shown: NAMES[name].length,
  back: false,
}));
const PILL = "h-11 rounded-full px-5 text-[0.9375rem]";

const FAQ = [
  [
    "What does agent-ctx do?",
    "One memory is shared by all of your coding agents, so work started in one agent is continued in the next agent without a new explanation.",
  ],
  [
    "Which agents work with agent-ctx?",
    "Claude Code is proven with the real program, and Cursor, Codex, Antigravity, Grok Build, Muse Code and the Claude desktop app are built from the documents of each vendor and are not yet tested with the real programs. macOS and Linux are supported today.",
  ],
  [
    "Where is the memory kept?",
    "The memory is one database file in the folder .agent-ctx in your home folder, and no account exists.",
  ],
  [
    "What is active in the background?",
    "Nothing is active while no agent is open. Each agent starts a small helper while that agent is open, and one hook is run at each prompt for a fraction of a second.",
  ],
  [
    "What leaves my computer?",
    "Nothing leaves your computer unless you turn on a mirror. A mirror copies the memory to a folder or a private repository of your own.",
  ],
  [
    "Can my agents be tricked by a web page or a file through the memory?",
    "Text from a web page or a file is stored as information and is delivered to an agent as quoted memory. Such text never becomes a rule unless you accept the rule yourself.",
  ],
  [
    "How do I remove agent-ctx?",
    "Every entry that was added is taken out with the command `~/.agent-ctx/app/agent-ctx uninstall`, and the memory file stays until you delete the folder.",
  ],
  [
    "What does agent-ctx cost?",
    "agent-ctx is free and open source under the MIT licence.",
  ],
];

const ROWS = RELEASED
  ? [
      ...FAQ.slice(0, 2),
      [
        "Can I install without an agent?",
        "Run `curl -fsSL https://sohanbhat.me/agent-ctx/install.sh | sh` in a terminal on macOS or Linux. On another system run `npx -y github:sohan-bhat/agent-ctx` with Node 22.16 or newer.",
      ],
      ...FAQ.slice(2),
    ]
  : FAQ;

const whole = (text: string) =>
  text.split(/(\S*agent-ctx\S*)/).map((part, i) =>
    i % 2 ? (
      <span key={i} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      part
    ),
  );

const DARK = "(prefers-color-scheme: dark)";
const system = window.matchMedia(DARK);
const scheme = new EventTarget();
const painted: string[] = [];
let choice: boolean | null = null;
const isDark = () => choice ?? system.matches;
Object.defineProperties(scheme, {
  matches: { get: isDark },
  media: { value: DARK },
});
system.addEventListener("change", () =>
  scheme.dispatchEvent(new Event("change")),
);
const query = window.matchMedia.bind(window);
window.matchMedia = (q) =>
  q === DARK ? (scheme as unknown as MediaQueryList) : query(q);

function tokens(dark: boolean): [string, string][] {
  const out: [string, string][] = [];
  const take = (rule: CSSRule) => {
    if (!(rule instanceof CSSStyleRule) || rule.selectorText !== ":root")
      return;
    for (const name of rule.style)
      if (name.startsWith("--") || name === "color-scheme")
        out.push([name, rule.style.getPropertyValue(name)]);
  };
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (!(rule instanceof CSSMediaRule)) take(rule);
        else if (
          dark &&
          rule.conditionText.replace(/\s/g, "") === DARK.replace(/\s/g, "")
        )
          for (const inner of rule.cssRules) take(inner);
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
  scheme.dispatchEvent(new Event("change"));
}

function watch(f: () => void) {
  scheme.addEventListener("change", f);
  return () => scheme.removeEventListener("change", f);
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

const between = (low: number, high: number) =>
  low + Math.random() * (high - low);

const idle = (at: (typeof START)[number]) =>
  !at.back && at.shown === NAMES[at.name].length;

const pause = (at: (typeof START)[number]) =>
  idle(at)
    ? between(1500, 5000)
    : !at.back
      ? between(60, 170)
      : at.shown
        ? between(30, 80)
        : between(200, 600);

function step(spots: typeof START, spot: number) {
  const at = spots[spot];
  if (!at.back) {
    const by = idle(at) ? -1 : 1;
    return { ...at, shown: at.shown + by, back: by < 0 };
  }
  if (at.shown) return { ...at, shown: at.shown - 1 };
  const free = NAMES.map((_, name) => name).filter(
    (name) => name !== at.name && name !== spots[1 - spot].name,
  );
  const name = free[Math.floor(Math.random() * free.length)];
  return { name, shown: 1, back: false };
}

const watchHidden = (f: () => void) => {
  document.addEventListener("visibilitychange", f);
  return () => document.removeEventListener("visibilitychange", f);
};
const isHidden = () => document.hidden;

function Caret({ blink }: { blink: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !blink) return;
    let id = 0;
    const flip = (off: boolean) => {
      el.toggleAttribute("data-off", off);
      id = window.setTimeout(
        () => flip(!off),
        off ? between(200, 550) : between(350, 900),
      );
    };
    flip(false);
    return () => {
      clearTimeout(id);
      el.removeAttribute("data-off");
    };
  }, [blink]);
  return (
    <span ref={ref} className="site-caret" data-blink={blink || undefined} />
  );
}

const drawing = new EventTarget();
let drawn = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isDrawn = () => drawn;
const watchDrawn = (f: () => void) => {
  drawing.addEventListener("change", f);
  return () => drawing.removeEventListener("change", f);
};
const finish = () => {
  if (drawn) return;
  drawn = true;
  drawing.dispatchEvent(new Event("change"));
};

function Logo() {
  const reduced = useReduced();
  const ended = useSyncExternalStore(watchDrawn, isDrawn);
  const done = reduced || ended;
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (done || !svg) {
      finish();
      return;
    }
    let end = 0;
    let id = 0;
    let late = 0;
    const start = () => {
      cancelAnimationFrame(id);
      clearTimeout(late);
      svg.setAttribute("data-draw", "run");
      end = window.setTimeout(finish, 2600);
    };
    const look = (stamp: number) => {
      if (performance.now() - stamp < 34) start();
      else id = requestAnimationFrame(look);
    };
    id = requestAnimationFrame(look);
    late = window.setTimeout(start, 700);
    return () => {
      cancelAnimationFrame(id);
      clearTimeout(late);
      clearTimeout(end);
    };
  }, [done]);
  return (
    <svg
      ref={ref}
      className="site-logo"
      data-site="logo"
      data-draw={done ? "done" : "wait"}
      viewBox="0 0 1210.002 172"
      aria-hidden
      focusable="false"
      onAnimationEnd={(e) => {
        if (
          e.animationName === "site-logo-line" &&
          (e.target as Element).parentElement === e.currentTarget.lastElementChild
        )
          finish();
      }}
    >
      {LOGO.map((d, i) => (
        <g
          key={d}
          style={
            { "--at": `${(0.5 * (1.06 ** i - 1)).toFixed(3)}s` } as CSSProperties
          }
        >
          <path d={d} data-part={i < 3 ? "mark" : "word"} />
          {d.split(/(?=M)/).map((line) => (
            <path key={line} d={line} pathLength={1} data-line="" />
          ))}
        </g>
      ))}
    </svg>
  );
}

function Typed() {
  const reduced = useReduced();
  const hidden = useSyncExternalStore(watchHidden, isHidden);
  const still = reduced || hidden;
  const [spots, setSpots] = useState(START);
  const now = useRef(spots);
  useEffect(() => {
    if (still) return;
    const ids = [0, 0];
    const run = (spot: number) => {
      const next = [...now.current];
      next[spot] = step(next, spot);
      now.current = next;
      setSpots(next);
      ids[spot] = window.setTimeout(() => run(spot), pause(next[spot]));
    };
    now.current.forEach((at, spot) => {
      ids[spot] = window.setTimeout(() => run(spot), pause(at));
    });
    return () => ids.forEach((id) => clearTimeout(id));
  }, [still]);
  return (
    <p className="site-typed" data-site="typed">
      <span className="sr-only">
        {`${OPEN} ${LEADS[0]} ${NAMES[0]} ${LEADS[1]} ${NAMES[1]}${TAIL}`}
      </span>
      <span aria-hidden data-site="open">
        {OPEN}
      </span>
      {LEADS.map((lead, spot) => (
        <span
          key={lead}
          aria-hidden
          data-room={`${lead} ${NAMES[NAMES.length - 1]}`}
          data-tail={spot ? TAIL : undefined}
        >
          <span>
            {" "}
            {lead}{" "}
            <span className="site-box" data-site="box">
              <span data-site="agent">
                {NAMES[spots[spot].name].slice(0, spots[spot].shown)}
              </span>
              <Caret blink={!still && idle(spots[spot])} />
            </span>
            {spot ? <span data-site="tail">{TAIL}</span> : null}
          </span>
        </span>
      ))}
    </p>
  );
}

function Action() {
  const still = useReduced();
  const [copied, setCopied] = useState(false);
  const back = useRef(0);
  useEffect(() => () => clearTimeout(back.current), []);
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
  const buzz = () => {
    try {
      navigator.vibrate?.(10);
    } catch {
      return;
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL);
      setCopied(true);
      clearTimeout(back.current);
      back.current = window.setTimeout(() => setCopied(false), 1600);
      buzz();
    } catch {
      setCopied(false);
    }
  };
  const host = INSTALL.indexOf("/", INSTALL.indexOf("//") + 2) + 1;
  const word = copied ? "Copied" : "Copy";
  const label = (
    <>
      {copied && (
        <svg className="site-check size-3.5" viewBox="0 0 16 16" aria-hidden>
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" pathLength={1} />
        </svg>
      )}
      {word}
    </>
  );
  return (
    <>
      <div className="site-action" data-site="action">
        <code
          translate="no"
          data-site="install"
          title={INSTALL}
          className="site-install num"
        >
          <span aria-hidden className="select-none">
            &gt;
          </span>
          <span className="select-all">
            {INSTALL.slice(0, host)}
            <wbr />
            <span className="whitespace-nowrap">{INSTALL.slice(host)}</span>
          </span>
        </code>
        <Button
          className="h-11 w-[6.75rem] rounded-full text-[0.9375rem]"
          aria-live="polite"
          onClick={() => void copy()}
        >
          {still ? (
            label
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <m.span
                key={word}
                className="inline-flex items-center gap-1.5"
                initial={{ opacity: 0, filter: "blur(2px)" }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, filter: "blur(2px)" }}
                transition={{ duration: 0.09 }}
              >
                {label}
              </m.span>
            </AnimatePresence>
          )}
        </Button>
        <Button asChild variant="outline" size="lg" className={PILL}>
          {home}
        </Button>
      </div>
    </>
  );
}

function Demo() {
  const reduced = useReduced();
  const frame = useRef<HTMLDivElement>(null);
  const [time, setTime] = useState(reduced ? DEMO_END : DEMO_START);
  const [seen, setSeen] = useState(false);
  const [stopped, setStopped] = useState(reduced);
  const wait = !useSyncExternalStore(watchDrawn, isDrawn);
  const idle = useRef({ held: false, open: false });
  useEffect(() => {
    const el = frame.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      ([entry]) => setSeen(entry.intersectionRatio >= 0.4),
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  useEffect(() => {
    if (!seen || stopped || wait) return;
    let id = 0;
    let last = performance.now();
    let due = 0;
    const step = (now: number) => {
      due +=
        idle.current.held || idle.current.open ? 0 : Math.min(100, now - last);
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
  }, [seen, stopped, wait]);
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
    <div
      ref={frame}
      className="site-demo"
      data-site="demo"
      data-wait={wait || undefined}
      onWheelCapture={scroll}
    >
      <Space
        wait={wait}
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

function Site() {
  return (
    <div className="site">
      <a
        href="#space"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-sm focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to the demo
      </a>
      <Top />
      <main>
        <div className="site-column site-head" data-site="column">
          <h1 translate="no">
            <span className="sr-only">agent-ctx</span>
            <Logo />
          </h1>
          <Typed />
          <p data-site="line">Universal memory shared by your coding agents.</p>
          <Action />
        </div>
        <Demo />
        <section className="site-column site-faq" data-site="faq">
          <h2 id="faq">FAQ</h2>
          {ROWS.map(([question, answer]) => (
            <div key={question}>
              <h3>{whole(question)}</h3>
              <p>
                {answer.split("`").map((part, i) =>
                  i % 2 ? (
                    <code key={i} translate="no" className="site-code num">
                      {whole(part)}
                    </code>
                  ) : (
                    <Fragment key={i}>{whole(part)}</Fragment>
                  ),
                )}
              </p>
            </div>
          ))}
        </section>
      </main>
      <footer className="site-foot">
        <p>MIT licence</p>
        <a href={HOME} rel="noreferrer" translate="no" className="num">
          github.com/{REPO}
        </a>
        <p>
          No cookie is set by this page and nothing is loaded from another host.
        </p>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Site />
  </StrictMode>,
);
