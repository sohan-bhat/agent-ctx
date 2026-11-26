import { Link } from '@/router';

const PAGES = {
  privacy: {
    title: 'Privacy',
    lines: [
      'What is stored is your GitHub user number and login name, and the items your agents save.',
      'Items are goals, file paths, decisions, commands, your prompts when a plugin with hooks is installed, and the final message of an agent turn.',
      'File contents and tool output are never stored.',
      'Text that looks like a key or password is removed on arrival.',
      'Stored content serves only the person who owns that content.',
      'Export and Delete account are in the menu.',
      'No email address is stored.',
    ],
  },
  terms: {
    title: 'Terms',
    lines: ['The service is free and comes with no warranty.', 'You own what your agents save.', 'You must be 16 or older.', 'Accounts that abuse the limits are closed.'],
  },
};

export function Legal({ page }: { page: keyof typeof PAGES }) {
  const p = PAGES[page];
  return (
    <div className="min-h-dvh px-4 pb-16 pt-5 sm:px-8 md:px-12 md:pt-8">
      <Link to="/" translate="no" className="text-[1.125rem] font-bold no-underline">
        agent-ctx
      </Link>
      <main className="mt-10 max-w-[40rem]">
        <h1 className="text-[1.75rem] font-bold leading-none tracking-[-0.02em]">{p.title}</h1>
        <ul className="mt-6 grid gap-3 text-[0.9375rem] leading-relaxed">
          {p.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </main>
    </div>
  );
}
