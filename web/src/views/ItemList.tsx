import { headline } from '@/lib/utils';
import { day } from '@/lib/utils';
import type { Item, Project } from '@/lib/api';

export function ItemList({ projects, agents, items, time, visible, onOpen }: { projects: Project[]; agents: string[]; items: Item[]; time: number; visible: boolean; onOpen: (id: string) => void }) {
  const shown = items.filter((i) => i.created <= time);
  const groups = projects
    .map((p) => {
      const mine = shown.filter((i) => i.project === p.key);
      const names = [...new Set(mine.map((i) => i.origin.agent))].sort((a, b) => agents.indexOf(a) - agents.indexOf(b));
      return { p, rows: names.map((name) => ({ name, list: mine.filter((i) => i.origin.agent === name).sort((a, b) => b.created - a.created) })) };
    })
    .filter((g) => g.rows.length);
  return (
    <div className={visible ? 'size-full overflow-y-auto overscroll-contain px-1 py-2' : 'sr-only'} data-list>
      {groups.map(({ p, rows }) => (
        <section key={p.key} aria-label={p.name} className="mb-6 [content-visibility:auto]">
          <h2 className="mb-2 text-[0.9375rem] font-bold">{p.name}</h2>
          {rows.map(({ name, list }) => (
            <div key={name} className="mb-3">
              <h3 translate="no" className="num mb-1 text-xs">
                {name === 'page' ? 'you' : name}
              </h3>
              <ul className="grid grid-cols-1">
                {list.map((i) => (
                  <li key={i.id}>
                    <button type="button" className="flex min-h-11 w-full items-baseline gap-3 rounded-sm px-1 text-left hover:bg-accent sm:min-h-8" onClick={() => onOpen(i.id)}>
                      <span className="min-w-0 flex-1 truncate">{headline(i)}</span>
                      <span className="num shrink-0 text-xs">{day(i.created)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
