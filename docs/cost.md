# Cost of running agent-ctx

Prices are the published Cloudflare Workers, Durable Objects and KV prices read on 2026-11-25. The load model is the one from the hosting study. Its guesses for rows and token refreshes are replaced by measurements in the local Workers runtime.

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

## Measured rows

The day test runs one base person through the 100 calls of the load mix. The store is a year old, with 600 items in each of 3 projects. The day has 10 sittings of 10 calls, and each sitting starts with an object that was evicted from memory, so every cache starts empty.

| | rows read a day | rows written a day |
|---|---|---|
| before, every call reads the recall pool from storage | 23,873 | 616 |
| after, hot state and recall pools kept in memory | 4,629 | 205 |
| security round, call counters written before the work of a call and every stored byte counted | 4,535 | 225 |
| repeated cards merged on write | 4,503 | 225 |

Now a call reads 45.03 rows and writes 2.25 rows on average. The call counters reach storage before the work of a call, with a reserve of 5 calls, so a crash never loses a count. Most reads are the one load of a 400 item recall pool at the start of a sitting.

The load test of 200 people and 20,000 calls with young stores measured 3.7 rows read and 1.3 written per read call, and 3.4 read and 3.1 written per write call. Every call reads 1 KV entry and writes none. A token refresh reads 2 KV entries and writes 2.

## Per person per day

Base person.

- Workers requests 106 = 100 calls + 3 refreshes + 3 page requests
- Durable Object requests 103.2 = 100 + 3 + 4 socket messages ÷ 20
- rows read 4,503 = 100 × 45.03
- rows written 225 = 100 × 2.25
- KV reads 106 = 100 + 3 × 2
- KV writes 6 = 3 × 2
- duration 0.645 GB-s = 103.2 × 0.05 s × 0.125 GB, an estimate that was not measured

Light person. Workers requests 34, Durable Object requests 33.2, rows read 1,350.9 = 30 × 45.03, rows written 67.5 = 30 × 2.25, KV reads 32, KV writes 2.

Heavy person. Workers requests 408, Durable Object requests 403.2, rows read 18,012 = 400 × 45.03, rows written 900 = 400 × 2.25, KV reads 410, KV writes 10. A heavy person works in longer sittings, so this overstates the reads.

## Free plan capacity

Each cell is the daily free cap divided by one person's daily use.

| Free cap a day | light | base | heavy |
|---|---|---|---|
| KV writes 1,000 | 500 | 166 | 100 |
| rows written 100,000 | 1,481 | 444 | 111 |
| rows read 5,000,000 | 3,701 | 1,110 | 277 |
| KV reads 100,000 | 3,125 | 943 | 243 |
| Workers requests 100,000 | 2,941 | 943 | 245 |
| Durable Object requests 100,000 | 3,012 | 968 | 248 |
| storage 5 GB, after a year | 3,333 | 1,000 | 500 |
| duration 13,000 GB-s | 62,650 | 20,155 | 5,158 |

The free plan carries 500 light people, 166 base people or 100 heavy people. KV writes from token refreshes break first for all three.

## Paid cost a month

Base person a month. Workers requests 3,180 = 106 × 30, CPU 15,900 ms = 3,180 × 5 ms, Durable Object requests 3,096, duration 19.35 GB-s, rows read 135,090, rows written 6,750, storage 0.005 GB, KV reads 3,180, KV writes 180.

| Line and rule | 1,000 people | 10,000 people | 100,000 people |
|---|---|---|---|
| base charge $5 | $5.00 | $5.00 | $5.00 |
| Workers requests over 10M at $0.30 a million | $0 | 21.8M × 0.30 = $6.54 | 308M × 0.30 = $92.40 |
| Workers CPU over 30M ms at $0.02 a million | $0 | 129M × 0.02 = $2.58 | 1,560M × 0.02 = $31.20 |
| Durable Object requests over 1M at $0.15 a million | 2.096M × 0.15 = $0.31 | 29.96M × 0.15 = $4.49 | 308.6M × 0.15 = $46.29 |
| duration over 400,000 GB-s at $12.50 a million | $0 | $0 | 1.535M × 12.50 = $19.19 |
| rows read over 25B at $0.001 a million | $0 | $0 | $0 |
| rows written over 50M at $1.00 a million | $0 | 17.5M × 1.00 = $17.50 | 625M × 1.00 = $625.00 |
| storage over 5 GB at $0.20 a GB | $0 | 45 × 0.20 = $9.00 | 495 × 0.20 = $99.00 |
| KV reads over 10M at $0.50 a million | $0 | 21.8M × 0.50 = $10.90 | 308M × 0.50 = $154.00 |
| KV writes over 1M at $5.00 a million | $0 | 0.8M × 5 = $4.00 | 17M × 5 = $85.00 |
| total a month | $5.31 | $60.01 | $1,157.08 |
| per 1,000 people | $5.31 | $6.00 | $11.57 |

Before the change the same table gave $175.51 at 10,000 people and $2,366.16 at 100,000. Rows written are now 54 percent of the bill at 100,000 people, and rows read fit inside the included 25 billion.

## Limits per account

These are the limits the service enforces, copied from service/src/limits.ts and core/src/caps.ts. A test fails when this list and the code differ.

- 60 calls a minute
- 2,000 calls a day
- 500 stored items a day
- 20 connected agents
- 2,048 bytes an item
- 10,485,760 bytes a person
- 8,192 bytes of input a call
