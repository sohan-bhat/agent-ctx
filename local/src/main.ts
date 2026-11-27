const NODE = [22, 16];

function recent(version: string): boolean {
  const [major, minor] = version.split('.').map(Number);
  return major > NODE[0] || (major === NODE[0] && minor >= NODE[1]);
}

function stop(line: string): never {
  process.stderr.write(`${line}\n`);
  process.exit(1);
}

function option(args: string[], name: string): string | undefined {
  const joined = args.find((a) => a.startsWith(`${name}=`));
  if (joined) return joined.slice(name.length + 1);
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

const args = process.argv.slice(2);

if (args[0] === 'hook') {
  await import(new URL('hook.mjs', import.meta.url).href).catch(() => undefined);
} else {
  if (!recent(process.versions.node)) stop(`Node ${NODE.join('.')} or newer is required for agent-ctx and this computer has Node ${process.versions.node}.`);
  if (args[0] === 'mcp') {
    const [{ serve }, { Refusal, file }] = await Promise.all([import('./serve.ts'), import('./db.ts')]);
    try {
      serve(option(args.slice(1), '--agent'));
    } catch (e) {
      stop(e instanceof Refusal ? e.message : `The memory file at ${file()} could not be opened.`);
    }
  } else {
    const { run } = await import('./cli.ts');
    process.exitCode = await run(args);
  }
}
