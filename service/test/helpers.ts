import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import type { Caller, Person } from '../src/person.ts';

export const RW = ['read', 'write'];

export function caller(agent: string, grant: string, scopes: string[] = RW): Caller {
  return { agent, grant, scopes };
}

let n = 0;
export function person(tag = 'p'): DurableObjectStub<Person> {
  n++;
  return env.PERSON.getByName(`dev-${tag}-${n}-${crypto.randomUUID().slice(0, 8)}`);
}

export function open(stub: DurableObjectStub<Person>, max: Partial<Person['limits']['max']> = {}): Promise<void> {
  return runInDurableObject(stub, (p: Person) => {
    p.limits.max = { ...p.limits.max, perMinute: 1e9, perDay: 1e9, storedPerDay: 1e9, ...max };
  });
}

export function sql<T>(stub: DurableObjectStub<Person>, query: string, ...args: (string | number | null)[]): Promise<T[]> {
  return runInDurableObject(stub, (p: Person) => p.store.q<T>(query, ...args));
}

export async function awayFromMinuteEdge(): Promise<void> {
  const left = 60000 - (Date.now() % 60000);
  if (left < 8000) await new Promise((r) => setTimeout(r, left + 200));
}

export const KILN = { repo: 'git@github.com:acme/kiln.git', folder: '/work/kiln' };
export const LOOM = { repo: 'https://github.com/acme/loom', folder: '/work/loom' };
