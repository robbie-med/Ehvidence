/**
 * notify.mjs—decoupled notifications. The scheduler (a short-lived process) must
 * not depend on the bot being importable/in-process, so it appends events to a
 * gitignored outbox file. The long-lived Telegram bot tails that file and
 * delivers each event. If the bot is down, events queue until it comes back.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { REPO_ROOT } from './env.mjs';

export const OUTBOX_PATH = join(REPO_ROOT, 'scripts', 'ingest', 'state', 'outbox.jsonl');

/**
 * Queue a notification. `kind` is a short tag (pr-open, repro-mismatch,
 * job-failure, budget, digest, shortlist). `text` is the human message.
 */
export function notify(kind, text, meta = {}, nowISO = '') {
  mkdirSync(dirname(OUTBOX_PATH), { recursive: true });
  const event = { ts: nowISO, kind, text, meta };
  appendFileSync(OUTBOX_PATH, JSON.stringify(event) + '\n');
  return event;
}
