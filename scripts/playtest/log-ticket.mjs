import fs from 'node:fs';
import path from 'node:path';

const TELEMETRY_TICKET_URL = process.env.TELEMETRY_TICKET_URL || 'http://localhost:5173/api/telemetry/ticket';
const RAW_FILE = path.resolve(process.cwd(), '.playtest-data', 'raw-findings.jsonl');

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--') && argv[i + 1] != null) {
      opts[a.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.category || !opts.title) {
  console.error(
    'Usage: node scripts/playtest/log-ticket.mjs --category virtual|rules --severity critical|high|medium|low --area "<area>" --title "<title>" --summary "<summary>" --repro "<repro>" --evidence "<evidence>" --reporter "<worker>"',
  );
  process.exit(1);
}

const ticket = {
  id: `raw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  category: opts.category,
  severity: opts.severity || 'medium',
  area: opts.area || 'general',
  title: opts.title,
  summary: opts.summary || '',
  repro: opts.repro || '',
  evidence: opts.evidence || '',
  reporter: opts.reporter || 'unknown',
  createdAt: Date.now(),
};

fs.mkdirSync(path.dirname(RAW_FILE), { recursive: true });
fs.appendFileSync(RAW_FILE, `${JSON.stringify(ticket)}\n`, 'utf8');

try {
  await fetch(TELEMETRY_TICKET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ticket),
  });
} catch {
  /* server may be offline; raw file already written */
}

console.log(JSON.stringify({ ok: true, id: ticket.id, category: ticket.category, title: ticket.title }));
