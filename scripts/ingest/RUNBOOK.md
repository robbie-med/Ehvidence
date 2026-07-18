# Ehvidence ingestion — operations runbook

The pipeline runs on the maintainer's Linux box. It finds high-impact clinical
meta-analyses, extracts them with DeepSeek, gates them against a live
reproduction check, and opens a PR per paper. **Nothing merges automatically**;
nothing is even extracted until you approve a candidate.

## 0. Node version (READ THIS FIRST)

The default `node` on this host is **v18**, but the pipeline needs **Node ≥22**
(`--env-file`, `tsx` type-stripping). Every scheduled/systemd invocation must
use the pinned binary:

```
/home/user/.local/share/pi-node/node-v22.23.1-linux-x64/bin/node
```

Override with `EHVIDENCE_NODE=/path/to/node22` if it ever moves. `env.mjs`
asserts ≥22 and fails loudly otherwise.

## 1. Secrets — `.env` (gitignored)

```
DEEPSEEK_API_KEY=...                    # extraction + triage worker (PPQ.AI key)
DEEPSEEK_BASE_URL=https://api.ppq.ai/v1 # NOTE the /v1 — PPQ's OpenAI-compatible path
DEEPSEEK_MODEL=deepseek/deepseek-chat   # fully-qualified PPQ model id (not bare "deepseek-chat")
ANTHROPIC_API_KEY=...          # OPTIONAL — sampled Claude audit; pipeline runs without it
TELEGRAM_BOT_TOKEN=...         # from @BotFather
TELEGRAM_CHAT_ID=...           # your own chat id — the bot rejects all others
MAX_PAPERS_PER_DAY=3
MONTHLY_BUDGET_USD=10
```

## 2. Manual flow (prove it before scheduling)

```
# P0 — discover + rank + dedupe (free, writes manifest)
npm run ingest:discover -- --print
node scripts/ingest/discover.mjs --dry-run     # offline fixture self-test

# Approve a candidate for extraction (CLI; or use the Telegram bot /queue)
#   edit scripts/ingest/state/manifest.json → set a paper's "status":"approved"

# P2 — extract one approved paper → PR (needs DEEPSEEK_API_KEY)
npm run ingest:extract -- <pmid>
npm run ingest:extract -- <pmid> --dry-run-pr  # build PR body without pushing

# Gates you can run standalone
npm run ingest:validate -- scripts/ingest/queue/<pmid>/topic.json
npm run ingest:repro -- <pmid>
```

All `npm run ingest:*` scripts run under `tsx` via the repo's node; when calling
directly, use the pinned Node 22 binary above.

## 3. Scheduler (cron)

One guarded pass per hour: discover → triage → extract approved (within budget)
→ sampled audit → periodic canary → digest. A lock file prevents overlap.

```cron
# crontab -e  (hourly at :17)
17 * * * * /home/user/.local/share/pi-node/node-v22.23.1-linux-x64/bin/node \
  /home/user/Projects/Ehvidence/node_modules/tsx/dist/cli.mjs \
  /home/user/Projects/Ehvidence/scripts/ingest/run.mjs \
  >> /home/user/Projects/Ehvidence/scripts/ingest/state/run.log 2>&1
```

Budget caps (`MAX_PAPERS_PER_DAY`, `MONTHLY_BUDGET_USD`) are enforced per run and
tracked in the manifest. Set `MAX_PAPERS_PER_DAY=0` to freeze extraction while
leaving discovery on. Create `scripts/ingest/state/paused` (or use the bot
`/pause`) to pause extraction without editing cron.

## 4. Telegram bot (systemd user unit)

The bot uses long-polling — it **binds no port**, so the machine's port registry
(`PORTS.md` / `port-claim.sh`) does not apply and none is claimed. If you ever
switch to webhooks you MUST claim a port first and bind `127.0.0.1`.

`~/.config/systemd/user/ehvidence-bot.service`:

```ini
[Unit]
Description=Ehvidence Telegram bot
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/user/Projects/Ehvidence
EnvironmentFile=/home/user/Projects/Ehvidence/.env
ExecStart=/home/user/.local/share/pi-node/node-v22.23.1-linux-x64/bin/node scripts/bot/bot.mjs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```
systemctl --user daemon-reload
systemctl --user enable --now ehvidence-bot
journalctl --user -u ehvidence-bot -f     # logs
```

## 5. State files (all gitignored under scripts/ingest/state/)

| File | Purpose |
|---|---|
| `manifest.json` | the pipeline's source of truth (papers + budget) |
| `run.lock` | scheduler mutex (auto-reclaimed if the pid is gone) |
| `paused` | presence pauses extraction |
| `outbox.jsonl` | scheduler → bot notification queue (bot tails it) |
| `audit-counter.json` | every-50 audit + periodic canary counter |
| `run.log` | cron stdout/stderr |

`scripts/ingest/queue/<pmid>/` holds per-paper artifacts. Only `topic.json` is
ever committed (to `src/content/topics/<slug>.json`); `reported-pooled.json` and
the rest stay local — that is what keeps reported/derived values out of the repo.
