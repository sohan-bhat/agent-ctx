# agent-ctx export format

An export is one zip file of plain text files that contains every item, rule and connected agent of one person.

## Folder layout

```
agent-ctx/
  README.md
  rules.jsonl
  agents.jsonl
  projects/
    tide-tables/
      items.jsonl
      handoff.md
    notes/
      items.jsonl
```

Each line of a jsonl file is one JSON object followed by a newline. A file with no objects is empty.

| Path | Contents |
|---|---|
| `agent-ctx/README.md` | Three lines of plain text about the folder |
| `agent-ctx/rules.jsonl` | Every item of kind `rule`, from every project, oldest first |
| `agent-ctx/agents.jsonl` | One line per connected agent, in the order the agents were first seen |
| `agent-ctx/projects/NAME/items.jsonl` | Every item of the project that is not a rule, oldest first |
| `agent-ctx/projects/NAME/handoff.md` | The newest handoff of the project as Markdown, present only when the project has a handoff |

NAME is the last part of the project key in lower case. Every run of characters outside `a-z`, `0-9`, `.`, `_` and `-` is replaced by one `-`, leading dots and hyphens are removed, and the name is cut to 60 characters. An empty result is replaced by `project`. When two projects have the same name, `-2` is added to the second name, `-3` to the third and so on.

A project key is either a cleaned git remote such as `github.com/example/tide-tables` or `folder:` followed by a folder name such as `folder:notes`. A known project with no items still has a folder with an empty `items.jsonl`.

The file `handoff.md` is a readable copy that starts with `# Handoff for` and the project name, then a line with the agent and the day, followed by one section per field that has a value, in the order Question, Goal, Done, Next, Blockers, Files, Check. The lines of `items.jsonl` are the full record.

| Agent field | Type | Meaning |
|---|---|---|
| `id` | string | Key of the connected agent product |
| `label` | string | Name shown on the page |
| `first` | number | Time the agent was first seen |
| `last` | number | Time the agent was last seen |

All times in the export are whole milliseconds since the Unix epoch in UTC.

## Item

Every line of `items.jsonl` and `rules.jsonl` is one item with these keys, in this order.

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Unique id of the item, a random UUID |
| `project` | string | Project key the item belongs to |
| `kind` | string | One of `card`, `handoff`, `rule`, `dropped` |
| `body` | object | The stored content, shaped by `kind` as set out in the tables below |
| `origin` | object | Where the item came from, see Origin |
| `flags` | string array | Findings of the safety check on the stored text, see Flags and states |
| `held` | boolean | True when the item is kept back from agents until the person accepts the item |
| `pinned` | boolean | True when the person pinned the item |
| `folded` | boolean | True when the item was shortened to one line to save space |
| `created` | number | Time the item was stored |

## Body of a card

A card is the record of one finished unit of work.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `goal` | string | yes | The aim of the work |
| `changed` | array of objects | no | Files changed, oldest first |
| `changed[].path` | string | yes in each entry | Path of the changed file |
| `changed[].what` | string | no | Short note on the change |
| `decisions` | array of objects | no | Decisions taken, oldest first |
| `decisions[].what` | string | yes in each entry | What was decided |
| `decisions[].why` | string | no | The reason |
| `commands` | string array | no | Commands worth knowing. On cards built from hook events a command whose last run failed ends with `exit failed` |
| `dead_ends` | string array | no | Approaches that did not work |
| `open` | string array | no | Tasks left open |
| `prompts` | string array | no | The person's prompts in the session, oldest first, on cards built from hook events |
| `last` | string | no | The agent's last message in the session |
| `auto` | boolean | no | True when the card was built from hook events and not written by an agent |

## Body of a handoff

A handoff is the state left for the next agent on a project.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `goal` | string | yes | What the work is for |
| `done` | string | no | What is finished |
| `next` | string | yes | The next step |
| `blockers` | string array | no | What stands in the way |
| `files` | string array | no | Files that matter for the next step |
| `check` | string | no | How to check the work |
| `question` | string | no | An open question for the person or the next agent |
| `task` | string | no | Task name given by the agent that wrote the handoff |
| `auto` | boolean | no | True when the handoff was built from hook events |

## Body of a rule

A rule is one instruction from the person that is in force in every agent.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `text` | string | yes | The rule as written down |
| `words` | string | yes | The words agents read. When words is empty, agents read text |
| `scope` | string | yes | `project` for the rule's own project or `all` for every project |
| `status` | string | yes | `active`, `pending` or `off`. Only active rules are shown to agents |
| `proof` | string | no | How the rule was made active. `elicit` when the person accepted the exact line inside an agent, `page` when the person added or accepted the rule on the page. `hook` may appear in an older store, and such a rule is treated as pending |

## Body of a dropped item

A dropped item is one thing that was removed from an agent's context by a compaction.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `label` | string | yes | What the removed thing was, such as `prompt`, `file` or `agent message` |
| `text` | string | yes | A short copy of the removed thing |
| `size` | number | yes | Length of the original in characters |

## Origin

| Field | Type | Required | Meaning |
|---|---|---|---|
| `agent` | string | yes | Agent product that wrote the item, or a list of agents for a merged item |
| `model` | string | no | Model name when known |
| `machine` | string | no | Machine label when known |
| `session` | string | no | Session id when known |
| `via` | string | yes | How the item arrived, see the table below |
| `source` | string | yes | Who the words come from, see the table below |
| `at` | number | yes | Time the item was written |

| `via` | Meaning |
|---|---|
| `hook` | Built from events sent by agent hooks while the work happened |
| `tool` | Written by an agent through a tool call |
| `page` | Added or changed by the person on the page |
| `import` | Read from past sessions on a machine |

| `source` | Meaning |
|---|---|
| `person` | The person's own words |
| `agent` | Text an agent wrote |
| `untrusted` | Text whose author is known to be neither the person nor an agent |

## Flags and states

`flags` is the list of findings on the stored text. All text is cleaned before storage, so each flag is about the text as received.

| Flag | Meaning |
|---|---|
| `hidden` | Tag characters, bidi controls or more than two zero width characters were removed |
| `role` | A fake role or harness marker was defanged, such as a system tag |
| `override` | A phrase written to override instructions was found |
| `shell` | A download piped into a shell or interpreter was found |
| `markup` | An HTML comment, a script or data link target, or a role word at a line start was removed |

Flag values not listed here may appear in later versions.

`held` is true when `flags` contains `role`, `override` or `shell`. A held item is never shown to an agent until the person presses Keep on the page. A rule not yet accepted by the person is kept from agents by the `status` of that rule and not by `held`.

`pinned` is set by the person. A pinned item is never folded, merged or deleted to save space.

`folded` is true when a card was shortened to save space. Only the time, the agent and the goal cut to 120 characters remain on the card, and the rest of the body is gone. When folding is not enough, folded cards of one project and one month are merged into one folded card whose `goal` is the list of old goals, one per line, each cut to 60 characters.

## Size caps

| Cap | Value | Measured as |
|---|---|---|
| Item body | 2048 bytes | UTF-8 length of the JSON of `body` |
| Store | 10485760 bytes | Sum of the item body sizes of one person |

Longer content is cut to fit the item cap before storage. When a store would be over 80 percent of the store cap after a new item, the oldest unpinned cards are folded, then merged, then deleted, until the store is back under 70 percent. After the cards, handoffs older than 30 days and dropped items may be deleted. Pinned items, rules and handoffs newer than 30 days are always kept. A write is refused when the store would still be over the store cap after that write.

## Example lines

These lines are made up. The card, handoff and dropped lines belong in an `items.jsonl` file and the rule line belongs in `rules.jsonl`.

```jsonl
{"id":"5f0c7a1e-2b9d-4e5a-9c41-0d8e6b3a7f21","project":"github.com/example/tide-tables","kind":"card","body":{"goal":"Cache the harbor tide table for offline use","changed":[{"path":"src/tides/cache.ts","what":"new store"}],"decisions":[{"what":"keep 14 days of predictions on the device","why":"boats lose signal past the breakwater"}],"commands":["npm test"],"dead_ends":["service worker cache filled up on old phones"],"open":["clear entries older than two weeks"]},"origin":{"agent":"codex","model":"m-1","machine":"desk","session":"s-41","via":"tool","source":"agent","at":1795132800000},"flags":[],"held":false,"pinned":false,"folded":false,"created":1795132800000}
{"id":"9a3d2c4b-7e1f-4b6a-8d20-5c9e1f0a4b33","project":"github.com/example/tide-tables","kind":"handoff","body":{"goal":"Offline tide table","done":"Cache and expiry written","next":"Show the age of the cached table in the header","files":["src/tides/cache.ts","src/ui/Header.tsx"],"check":"npm test"},"origin":{"agent":"claude-code","session":"s-42","via":"tool","source":"agent","at":1795219200000},"flags":[],"held":false,"pinned":false,"folded":false,"created":1795219200000}
{"id":"c41e8b2a-0f6d-4c3e-a9b7-2d5f8e1c6a90","project":"github.com/example/tide-tables","kind":"rule","body":{"text":"Use metres in every reading","words":"always show heights in metres","scope":"project","status":"active","proof":"elicit"},"origin":{"agent":"cursor","session":"g-43","via":"tool","source":"person","at":1795305600000},"flags":[],"held":false,"pinned":false,"folded":false,"created":1795305600000}
{"id":"e7b5a3c9-1d2f-4e8a-b6c0-9f3a2e7d5b14","project":"github.com/example/tide-tables","kind":"dropped","body":{"label":"file","text":"src/tides/cache.ts","size":18},"origin":{"agent":"claude-code","session":"s-42","via":"hook","source":"agent","at":1795222800000},"flags":[],"held":false,"pinned":false,"folded":false,"created":1795222800000}
```

## Version

Format 1.
