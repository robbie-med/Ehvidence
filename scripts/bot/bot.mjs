/**
 * bot.mjs—the Ehvidence Telegram bot. Interactive control of the ingestion
 * pipeline from your phone: it pushes notifications AND lets you approve/reject
 * ranked candidates (the human-in-the-loop gate happens here).
 *
 * TRANSPORT: telegraf long-polling. This opens an OUTBOUND connection to
 * Telegram and binds NO listening port, so the machine's port registry
 * (PORTS.md / port-claim.sh) does not apply and no port is claimed. If you ever
 * switch to webhooks you MUST claim a port via port-claim.sh and bind 127.0.0.1.
 *
 * SECURITY: every update is rejected unless it comes from TELEGRAM_CHAT_ID.
 *
 * Run as a systemd user unit (see scripts/ingest/RUNBOOK.md). Requires Node ≥22.
 */
import { existsSync, readFileSync, writeFileSync, watch, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { Telegraf } from 'telegraf';
import { REPO_ROOT, loadDotenv, assertNode22, PINNED_NODE } from '../ingest/lib/env.mjs';
import {
  loadManifest,
  saveManifest,
  transition,
  papersByStatus,
} from '../ingest/lib/manifest.mjs';

assertNode22();
loadDotenv();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || '');
const STATE_DIR = join(REPO_ROOT, 'scripts', 'ingest', 'state');
const OUTBOX = join(STATE_DIR, 'outbox.jsonl');
const PAUSED = join(STATE_DIR, 'paused');
const LOCK = join(STATE_DIR, 'run.lock');
const nowISO = () => new Date().toISOString();

if (!TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN not set — cannot start bot.');
  process.exit(1);
}
if (!CHAT_ID) {
  console.error('TELEGRAM_CHAT_ID not set — refusing to start an unrestricted bot.');
  process.exit(1);
}

const bot = new Telegraf(TOKEN);

// Hard gate: only the configured chat may talk to this bot.
bot.use((ctx, next) => {
  if (String(ctx.chat?.id) !== CHAT_ID) return; // silently ignore everyone else
  return next();
});

function budgetLine(m) {
  const b = m.budget;
  return `Budget: $${b.spentUSD}/${process.env.MONTHLY_BUDGET_USD || '?'} this month · ${b.papersToday}/${process.env.MAX_PAPERS_PER_DAY || '?'} papers today`;
}

function countsLine(m) {
  const states = ['ranked', 'approved', 'reproFailed', 'prOpen', 'error'];
  return states.map((s) => `${s}: ${papersByStatus(m, s).length}`).join(' · ');
}

bot.command('status', (ctx) => {
  const m = loadManifest();
  const paused = existsSync(PAUSED) ? '\n⏸ PAUSED' : '';
  const running = existsSync(LOCK) ? '\n▶ a run is in progress' : '';
  ctx.reply(`📊 Ehvidence pipeline\n${budgetLine(m)}\n${countsLine(m)}${paused}${running}`);
});

bot.command('queue', (ctx) => {
  const m = loadManifest();
  const candidates = [...papersByStatus(m, 'ranked'), ...papersByStatus(m, 'triaged')]
    .sort((a, b) => (b.scores?.total || 0) - (a.scores?.total || 0))
    .slice(0, 8);
  if (candidates.length === 0) return ctx.reply('Queue is empty. Run discovery first.');
  for (const p of candidates) {
    const score = p.scores?.total ?? '—';
    ctx.reply(
      `[${score}] ${p.title}\nPMID ${p.pmid} · ${p.year || ''} · ${p.oaFullText ? 'OA' : 'paywalled'}`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Approve', callback_data: `approve:${p.pmid}` },
              { text: '🚫 Reject', callback_data: `reject:${p.pmid}` },
            ],
          ],
        },
      },
    );
  }
});

bot.on('callback_query', (ctx) => {
  const data = ctx.callbackQuery.data || '';
  const [action, pmid] = data.split(':');
  const m = loadManifest();
  const p = m.papers[pmid];
  if (!p) return ctx.answerCbQuery('Unknown paper.');
  try {
    if (action === 'approve') {
      transition(m, pmid, p.status, 'approved', { nowISO: nowISO() });
      p.approvedBy = 'telegram';
      saveManifest(m);
      ctx.answerCbQuery('Approved ✅');
      ctx.reply(`Approved for extraction on the next run: ${p.title}`);
    } else if (action === 'reject') {
      transition(m, pmid, p.status, 'rejected', { nowISO: nowISO() });
      saveManifest(m);
      ctx.answerCbQuery('Rejected 🚫');
      ctx.reply(`Rejected: ${p.title}`);
    }
  } catch (e) {
    ctx.answerCbQuery('No-op');
    ctx.reply(`Could not ${action} ${pmid}: ${e.message}`);
  }
});

bot.command('run', (ctx) => {
  if (existsSync(LOCK)) return ctx.reply('A run is already in progress.');
  ctx.reply('Starting a run…');
  const child = spawn(PINNED_NODE, [join(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs'), join(REPO_ROOT, 'scripts/ingest/run.mjs')], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
});

bot.command('pause', (ctx) => {
  writeFileSync(PAUSED, nowISO());
  ctx.reply('⏸ Extraction paused. Discovery still runs. /resume to re-enable.');
});

bot.command('resume', (ctx) => {
  rmSync(PAUSED, { force: true });
  ctx.reply('▶ Extraction resumed.');
});

bot.command('help', (ctx) =>
  ctx.reply('/status · /queue (approve/reject candidates) · /run · /pause · /resume'),
);

/**
 * Tail the scheduler's outbox and push each event to the chat. Tracks a byte
 * offset so a restart does not replay old events. The scheduler and bot never
 * share memory — only this file.
 */
function startOutboxTail() {
  let offset = existsSync(OUTBOX) ? readFileSync(OUTBOX).length : 0;
  const flush = () => {
    if (!existsSync(OUTBOX)) return;
    const buf = readFileSync(OUTBOX);
    if (buf.length <= offset) return;
    const chunk = buf.slice(offset).toString('utf8');
    offset = buf.length;
    for (const line of chunk.split('\n').filter(Boolean)) {
      try {
        const e = JSON.parse(line);
        bot.telegram.sendMessage(CHAT_ID, `${iconFor(e.kind)} ${e.text}`);
      } catch {
        /* skip malformed line */
      }
    }
  };
  try {
    watch(STATE_DIR, (_evt, file) => {
      if (file === 'outbox.jsonl') flush();
    });
  } catch {
    // Directory may not exist yet; poll as a fallback.
    setInterval(flush, 15000);
  }
}

function iconFor(kind) {
  return (
    {
      'pr-open': '🔀',
      'repro-mismatch': '❌',
      'job-failure': '🔥',
      budget: '💰',
      digest: '📊',
      shortlist: '🆕',
      audit: '🔎',
    }[kind] || 'ℹ️'
  );
}

startOutboxTail();
bot
  .launch(() => {
    console.log('Ehvidence bot started (long-polling, no port bound).');
    bot.telegram.sendMessage(CHAT_ID, '🤖 Ehvidence bot online. /help for commands.').catch(() => {});
  })
  .catch((e) => {
    console.error(`Bot failed to launch: ${e.message}. Check TELEGRAM_BOT_TOKEN.`);
    process.exit(1);
  });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
