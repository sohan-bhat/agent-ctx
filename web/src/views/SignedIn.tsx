import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ListIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import { megabytes, since } from '@/lib/format';
import { isPending } from '@/lib/item';
import type { Agent, Item, Live, Me, RuleBody, Space as SpaceData } from '@/lib/types';
import { navigate } from '@/router';
import { AddAgent } from './AddAgent';
import { DeleteAccount } from './DeleteAccount';
import type { Actions } from './Panel';
import { Rules, type RuleActions } from './Rules';
import { Space } from './Space';

const HOUR = 3_600_000;

function upsert<T extends { id: string }>(list: T[], next: T): T[] {
  const i = list.findIndex((x) => x.id === next.id);
  if (i < 0) return [...list, next];
  const out = list.slice();
  out[i] = next;
  return out;
}

export function SignedIn({ me: first, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const [me, setMe] = useState(first);
  const [data, setData] = useState<SpaceData | null>(null);
  const [failed, setFailed] = useState(false);
  const [online, setOnline] = useState(true);
  const [offset, setOffset] = useState(0);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [scrub, setScrub] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [rules, setRules] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const addingRef = useRef(false);
  addingRef.current = adding;
  const meTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentIds = useRef(new Set<string>());
  agentIds.current = new Set((data?.agents ?? []).map((a) => a.id));

  const load = useCallback(async () => {
    try {
      const s = await api.space();
      setData(s);
      setOffset(s.now - Date.now());
      setClockNow(Date.now());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  const refreshMe = useCallback(() => {
    if (meTimer.current) clearTimeout(meTimer.current);
    meTimer.current = setTimeout(() => {
      api
        .me()
        .then((m) => (m ? setMe(m) : onSignedOut()))
        .catch(() => {});
    }, 1500);
  }, [onSignedOut]);

  useEffect(() => {
    void load();
    const stop = api.live(
      (m: Live) => {
        if (m.type === 'reset') {
          void load();
          return;
        }
        if (m.type === 'agent' && addingRef.current && !agentIds.current.has(m.agent.id)) setAdding(false);
        setData((d) => {
          if (!d) return d;
          if (m.type === 'item') return { ...d, items: upsert(d.items, m.item) };
          if (m.type === 'remove') return { ...d, items: d.items.filter((i) => i.id !== m.id), queue: d.queue.filter((q) => q !== m.id) };
          return { ...d, agents: upsert(d.agents, m.agent) };
        });
        if (m.type !== 'agent') {
          setClockNow(Date.now());
          refreshMe();
        }
      },
      setOnline,
    );
    const tick = setInterval(() => setClockNow(Date.now()), 30_000);
    return () => {
      stop();
      clearInterval(tick);
      if (meTimer.current) clearTimeout(meTimer.current);
    };
  }, [load, refreshMe]);

  const items = data?.items ?? [];
  const agents = useMemo(() => [...(data?.agents ?? [])].sort((a, b) => a.first - b.first), [data?.agents]);
  const labels = useMemo(() => {
    const out = agents.map((a) => a.label);
    for (const i of items) if (i.origin.agent !== 'page' && !out.includes(i.origin.agent)) out.push(i.origin.agent);
    return out;
  }, [agents, items]);
  const now = clockNow + offset;
  const newest = items.reduce((m, i) => Math.max(m, i.created), 0);
  const end = Math.max(now, newest);
  const oldest = items.reduce((m, i) => Math.min(m, i.created), end);
  const start = Math.min(oldest, end - HOUR);
  const time = scrub ?? end;
  const queue = useMemo(() => new Set(data?.queue ?? []), [data?.queue]);
  const projects = data?.projects ?? [];

  const patch = (id: string, f: (i: Item) => Item) => setData((d) => (d ? { ...d, items: d.items.map((i) => (i.id === id ? f(i) : i)) } : d));

  const actions: Actions = {
    pin: async (id, on) => {
      patch(id, (i) => ({ ...i, pinned: on }));
      try {
        await api.pin(id, on);
      } catch (e) {
        patch(id, (i) => ({ ...i, pinned: !on }));
        throw e;
      }
    },
    putBack: async (id) => {
      await api.putBack(id);
      setData((d) => (d ? { ...d, queue: [...new Set([...d.queue, id])] } : d));
    },
    keep: async (id) => {
      const it = items.find((i) => i.id === id);
      if (it && isPending(it)) {
        await api.setRule(id, 'active');
        patch(id, (i) => ({ ...i, body: { ...(i.body as RuleBody), status: 'active' } }));
      } else {
        await api.keep(id);
        patch(id, (i) => ({ ...i, held: false }));
      }
    },
    remove: async (id) => {
      await api.remove(id);
      setData((d) => (d ? { ...d, items: d.items.filter((i) => i.id !== id) } : d));
    },
  };

  const ruleActions: RuleActions = {
    add: async (rule) => {
      const it = await api.addRule(rule);
      setData((d) => (d ? { ...d, items: upsert(d.items, it) } : d));
    },
    set: async (id, status) => {
      await api.setRule(id, status);
      patch(id, (i) => ({ ...i, body: { ...(i.body as RuleBody), status } }));
    },
    reject: actions.remove,
  };

  const storage = `${megabytes(me.limits.bytes)} of ${megabytes(me.limits.max)} MB`;
  const cost = `about ${Math.round(me.toolChars / 4).toLocaleString('en-US')} tokens added to each agent`;
  const notice = failed ? (
    <p>No connection to the service. Reload to try again.</p>
  ) : !online ? (
    <p>No live updates right now.</p>
  ) : data && !items.length ? (
    <p>{agents.length ? `${agents.map((a) => a.label).join(', ')} connected. Nothing saved yet.` : 'Add agent to begin.'}</p>
  ) : null;

  return (
    <div className="flex h-dvh flex-col px-4 pb-3 pt-3 sm:px-8 md:px-12 md:pt-5">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <h1 translate="no" className="text-[1.125rem] font-bold leading-none tracking-[-0.01em]">
          agent-ctx
        </h1>
        <ul className="order-last flex basis-full flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] sm:order-none sm:basis-auto" aria-label="Connected agents" data-agents>
          {agents.map((a: Agent) => (
            <li key={a.id} className="whitespace-nowrap" data-agent={a.label}>
              {a.label} <span className="num inline-block min-w-[3ch] text-xs">{since(a.last, now)}</span>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-3">
          <span className="num hidden text-xs md:inline" data-storage>
            {storage}
          </span>
          <Button className="h-11 rounded-full px-4 text-sm sm:h-9" onClick={() => setAdding(true)}>
            Add agent
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="-mr-2 size-11 sm:size-9" aria-label="Menu">
                <ListIcon className="size-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60 text-sm">
              <DropdownMenuLabel className="num grid gap-1 text-xs text-foreground md:hidden">
                <span>{storage}</span>
                <span>{cost}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="md:hidden" />
              <DropdownMenuItem className="min-h-11 text-sm sm:min-h-8" onSelect={() => setRules(true)}>
                Rules
              </DropdownMenuItem>
              <DropdownMenuItem className="min-h-11 text-sm sm:min-h-8" onSelect={() => void api.exportAll()}>
                Export
              </DropdownMenuItem>
              <DropdownMenuItem className="min-h-11 text-sm text-destructive focus:text-destructive sm:min-h-8" onSelect={() => setDeleting(true)}>
                Delete account
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="min-h-11 text-sm sm:min-h-8" onSelect={() => location.assign('/logout')}>
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <p className="num mt-1 hidden text-xs md:block" data-cost>
        {cost}
      </p>
      <main className="relative mt-3 min-h-0 flex-1">
        <Space
          projects={projects}
          agents={labels}
          items={items}
          queue={queue}
          start={start}
          end={end}
          time={time}
          actions={actions}
          notice={notice}
          label="Your shared space"
          prefer={items.length ? items.reduce((a, b) => (b.created > a.created ? b : a)).project : null}
          onTime={(t) => setScrub(t >= end - (end - start) / 600 ? null : t)}
        />
      </main>
      <AddAgent open={adding} onOpenChange={setAdding} />
      <Rules open={rules} onOpenChange={setRules} items={items} projects={projects} actions={ruleActions} />
      <DeleteAccount
        open={deleting}
        onOpenChange={setDeleting}
        onDelete={async () => {
          await api.deleteAccount();
          setDeleting(false);
          navigate('/', true);
          onSignedOut();
        }}
      />
    </div>
  );
}
