# Cost of running agent-ctx

Prices are the published Cloudflare Workers, Durable Objects and KV prices read on 2026-11-25. The load model is the one from the hosting study. Two of its guesses are replaced by measurements from the load test of 1,000 people and 100,000 calls in the local Workers runtime.

## What a person does in a day

| | light | base | heavy |
|---|---|---|---|
| MCP calls | 30 | 100 | 400 |
| reads and writes | 18 and 12 | 60 and 40 | 240 and 160 |
| connected agents | 1 | 3 | 5 |
| token refreshes | 1 | 3 | 5 |
| page requests | 3 | 3 | 3 |
| stored after a year | 1.5 MB | 5 MB | 10 MB |

Access tokens last 24 hours, so each agent refreshes about once a day. The study guessed 10 refreshes a day for 1 hour tokens.

## Measured per call

| | rows read | rows written | KV reads | KV writes |
|---|---|---|---|---|
| read call, recall or prompt hook | 416 | 4.5 | 1 | 0 |
| write call, save or other hook | 35 | 8.5 | 1 | 0 |
| token refresh | 0 | 0 | 2 | 2 |

Rows written are the means over the 60 reads and 40 writes of the load mix. The study guessed 5 rows written per stored item and 0 per read. Every call writes 1 row for the account counters, and a prompt hook also stores the prompt.

Rows read per read call are 416 once a project holds the full recall pool of 400 items, the case of a store a year old. A young store reads about 31 rows per read call. Rows read per write call are 35 in a full store, most of them from the rebuild after a stop.

## Per person per day

Base person.

- Workers requests 106 = 100 calls + 3 refreshes + 3 page requests
- Durable Object requests 103.2 = 100 + 3 + 4 socket messages ÷ 20
- rows read 26,360 = 60 × 416 + 40 × 35
- rows written 610 = 60 × 4.5 + 40 × 8.5
- KV reads 106 = 100 + 3 × 2
- KV writes 6 = 3 × 2
- duration 0.645 GB-s = 103.2 × 0.05 s × 0.125 GB, an estimate that was not measured

Light person. Workers requests 34, Durable Object requests 33.2, rows read 7,908 = 18 × 416 + 12 × 35, rows written 183 = 18 × 4.5 + 12 × 8.5, KV reads 32, KV writes 2.

Heavy person. Workers requests 408, Durable Object requests 403.2, rows read 105,440 = 240 × 416 + 160 × 35, rows written 2,440 = 240 × 4.5 + 160 × 8.5, KV reads 410, KV writes 10.

## Free plan capacity

Each cell is the daily free cap divided by one person's daily use.

| Free cap a day | light | base | heavy |
|---|---|---|---|
| rows written 100,000 | 546 | 163 | 40 |
| rows read 5,000,000 | 632 | 189 | 47 |
| KV writes 1,000 | 500 | 166 | 100 |
| KV reads 100,000 | 3,125 | 943 | 243 |
| Workers requests 100,000 | 2,941 | 943 | 245 |
| Durable Object requests 100,000 | 3,012 | 968 | 248 |
| storage 5 GB, after a year | 3,333 | 1,000 | 500 |
| duration 13,000 GB-s | 62,650 | 20,155 | 5,158 |

The free plan carries 500 light people, 163 base people or 40 heavy people. KV writes break first for light people. Rows written break first for base and heavy people.

## Paid cost a month

Base person a month. Workers requests 3,180 = 106 × 30, CPU 15,900 ms = 3,180 × 5 ms, Durable Object requests 3,096, duration 19.35 GB-s, rows read 790,800, rows written 18,300, storage 0.005 GB, KV reads 3,180, KV writes 180.

| Line and rule | 1,000 people | 10,000 people | 100,000 people |
|---|---|---|---|
| base charge $5 | $5.00 | $5.00 | $5.00 |
| Workers requests over 10M at $0.30 a million | $0 | 21.8M × 0.30 = $6.54 | 308M × 0.30 = $92.40 |
| Workers CPU over 30M ms at $0.02 a million | $0 | 129M × 0.02 = $2.58 | 1,560M × 0.02 = $31.20 |
| Durable Object requests over 1M at $0.15 a million | 2.096M × 0.15 = $0.31 | 29.96M × 0.15 = $4.49 | 308.6M × 0.15 = $46.29 |
| duration over 400,000 GB-s at $12.50 a million | $0 | $0 | 1.535M × 12.50 = $19.19 |
| rows read over 25B at $0.001 a million | $0 | $0 | 54,080M × 0.001 = $54.08 |
| rows written over 50M at $1.00 a million | $0 | 133M × 1.00 = $133.00 | 1,780M × 1.00 = $1,780.00 |
| storage over 5 GB at $0.20 a GB | $0 | 45 × 0.20 = $9.00 | 495 × 0.20 = $99.00 |
| KV reads over 10M at $0.50 a million | $0 | 21.8M × 0.50 = $10.90 | 308M × 0.50 = $154.00 |
| KV writes over 1M at $5.00 a million | $0 | 0.8M × 5 = $4.00 | 17M × 5 = $85.00 |
| total a month | $5.31 | $175.51 | $2,366.16 |
| per 1,000 people | $5.31 | $17.55 | $23.66 |

Rows written are 75 percent of the bill at 100,000 people. One row of every call is the account counter. Keeping the counters in memory and writing them once a minute would remove about 100 of the 610 rows a base person writes each day.

## Limits per account

These are the limits the service enforces, copied from service/src/limits.ts and core/src/caps.ts. A test fails when this list and the code differ.

- 60 calls a minute
- 2,000 calls a day
- 500 stored items a day
- 20 connected agents
- 2,048 bytes an item
- 10,485,760 bytes a person
- 8,192 bytes of input a call
