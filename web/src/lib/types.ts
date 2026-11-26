import type { CardBody, DroppedBody, HandoffBody, Item as Stored, Kind, Origin, RuleBody } from '@core/model.ts';

export type { CardBody, DroppedBody, HandoffBody, Kind, Origin, RuleBody };

export type Item = Stored & { line?: string };

export interface Person {
  id: string;
  login: string;
}

export interface Limits {
  bytes: number;
  max: number;
  callsToday: number;
  storedToday: number;
}

export interface Me {
  person: Person;
  limits: Limits;
  toolChars: number;
}

export interface Project {
  key: string;
  name: string;
  items: number;
}

export interface Agent {
  id: string;
  label: string;
  first: number;
  last: number;
}

export interface Read {
  item: string;
  agent: string;
  at: number;
}

export interface Space {
  projects: Project[];
  agents: Agent[];
  items: Item[];
  queue: string[];
  reads: Read[];
  now: number;
}

export type Live = { type: 'item'; item: Item } | { type: 'remove'; id: string } | { type: 'agent'; agent: Agent } | { type: 'agent-removed'; id: string } | { type: 'reset' };

export type RuleScope = 'project' | 'all';

export interface NewRule {
  text: string;
  scope: RuleScope;
  project?: string;
}

export interface Transport {
  me(): Promise<Me | null>;
  space(): Promise<Space>;
  pin(id: string, on: boolean): Promise<void>;
  keep(id: string): Promise<void>;
  putBack(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  addRule(rule: NewRule): Promise<Item>;
  setRule(id: string, status: 'active' | 'off', line?: string): Promise<void>;
  removeAgent(id: string): Promise<void>;
  signOut(): Promise<void>;
  merge(from: string, into: string): Promise<void>;
  exportAll(): Promise<void>;
  deleteAccount(): Promise<void>;
  live(on: (m: Live) => void, state: (open: boolean) => void): () => void;
  hint(product: string): void;
}
