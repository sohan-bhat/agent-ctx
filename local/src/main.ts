import { Refusal, file } from './db.ts';

declare const VERSION: string;

const NODE = [22, 16];

function recent(version: string): boolean {
  const [major, minor] = version.split('.').map(Number);
  return major > NODE[0] || (major === NODE[0] && minor >= NODE[1]);
}

function stop(...lines: string[]): never {
  process.stderr.write(`${lines.join('\n')}\n`);
  process.exit(1);
}

function option(args: string[], name: string): string | undefined {
  const joined = args.find((a) => a.startsWith(`${name}=`));
  if (joined) return joined.slice(name.length + 1);
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

const ABOUT = [
  `agent-ctx ${VERSION} is one memory on this computer, shared by every agent you use.`,
  `The memory is kept in one file at ${file()} and nothing stays open in the background.`,
  'An agent opens the memory with agent-ctx mcp --agent NAME.',
  'The installer arrives in a later version.',
];

const args = process.argv.slice(2);
const command = args[0];

if (!recent(process.versions.node)) stop(`Node ${NODE.join('.')} or newer is required for agent-ctx and this computer has Node ${process.versions.node}.`);

if (command === undefined || command === '--help' || command === '-h') {
  process.stdout.write(`${ABOUT.join('\n')}\n`);
} else if (command === '--version') {
  process.stdout.write(`${VERSION}\n`);
} else if (command === 'mcp') {
  const { serve } = await import('./serve.ts');
  try {
    serve(option(args.slice(1), '--agent'));
  } catch (e) {
    stop(e instanceof Refusal ? e.message : `The memory file at ${file()} could not be opened.`);
  }
} else {
  stop(`No command named ${command.replace(/[^\w.-]+/g, '').slice(0, 40)} exists in this version.`, ...ABOUT);
}
