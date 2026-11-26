import { Link } from '@/router';

const PAGES = {
  privacy: {
    title: 'Privacy',
    lines: [
      'What is stored.',
      'Your GitHub user number and login name.',
      'The items your agents save, with goals, file paths, decisions, commands and open tasks.',
      'With a plugin installed, each prompt you type, each edited file path, each shell command line and the final message of each agent turn are sent to the service as the work happens.',
      'File contents and tool output are never sent or stored.',
      'Text that looks like a key or a password is removed on arrival, before anything is stored, and text inside a private tag is dropped.',
      'No email address is stored.',
      'Stored content is used only for the person who owns that content.',
      'Export and Delete account are in the menu, and with Delete account everything is removed at once.',
    ],
  },
  terms: {
    title: 'Terms',
    lines: ['The service is free and is provided with no warranty.', 'You own what your agents save.', 'You must be 16 or older.', 'Accounts used to abuse the limits are closed.'],
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
