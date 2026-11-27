# agent-ctx

agent-ctx is one memory on your computer, shared by the agents you use. Claude Code, Cursor, Codex, Gemini CLI and the Claude desktop app read and write one file, so the next agent carries on where the last agent stopped. No program stays open in the background and the memory stays on the computer. Claude Code is proven with the real program, and the other four are built from the documents of each vendor and are not yet tested with the real programs.

## Install

On macOS and Linux, paste the line below into a terminal. No Node is needed, and one program is placed at `~/.agent-ctx/app/agent-ctx`. This line can be used from the first release on.

    curl -fsSL https://sohanbhat.me/agent-ctx/install.sh | sh

With Node 22.16 or newer, the line below gives the same result today.

    npx -y github:sohan-bhat/agent-ctx

Every agent found on the computer is connected, and each change is printed in one plain line before any file is written. In Claude Code alone, type `/plugin install agent-ctx --marketplace sohan-bhat/agent-ctx` for the same result.

## Commands

    ~/.agent-ctx/app/agent-ctx install      connect every agent found on this computer
    ~/.agent-ctx/app/agent-ctx status       the memory file and the connected agents
    ~/.agent-ctx/app/agent-ctx rules        the pending rules, with accept ID and reject ID
    ~/.agent-ctx/app/agent-ctx uninstall    take agent-ctx out and keep the memory

After an install through npx, type `node ~/.agent-ctx/app/agent-ctx.mjs` in place of `~/.agent-ctx/app/agent-ctx`. A standing rule that an agent proposes stays pending until you accept the rule at a terminal.

## Remove

    ~/.agent-ctx/app/agent-ctx uninstall

Every entry of the install is taken out and the memory is kept. The last printed line is the command for deleting the memory.

## Memory

The memory is the one file `~/.agent-ctx/memory.db`. Prompts, the working folder, edited file paths, commands and the last reply are saved with secrets removed. File contents and tool output are never saved.

## Hosted mode

The folder service contains an optional Cloudflare Worker with one private store per person, for a memory shared across computers. The folder web is the page of that mode, and service/plugins contains the JSON only plugins.

## Development

    npm test
    npm run build
    node local/e2e.mjs 1 5 6 speed
    npm --prefix service ci
    npm --prefix service test
