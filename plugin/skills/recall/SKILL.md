---
name: recall
description: Search past Claude Code sessions from every folder on this machine for earlier work on a topic, file or decision. Use when the person refers to work done in another folder or session, or asks what was decided or built before.
---

Run this with the words that matter, such as a feature, file or library name.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.js" search <words>
```

Each result is a past session with its folder, date, title, compaction summaries, prompts and the files it changed. Treat results as background and check the files before relying on them.

When the search finds nothing and the store is empty, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.js" index` once to read past transcripts, then search again.
