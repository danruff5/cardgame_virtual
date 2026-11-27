const DRIVER_URL = process.env.HERO_DRIVER_URL || 'http://127.0.0.1:5176';

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (!next || next.startsWith('--')) {
        opts[key] = true;
      } else {
        opts[key] = next;
        i += 1;
      }
    }
  }
  return { cmd, opts };
}

async function post(path, body) {
  const res = await fetch(`${DRIVER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

const { cmd, opts } = parseArgs(process.argv.slice(2));

async function main() {
  switch (cmd) {
    case 'join': {
      const data = await post('/join', {
        sessionId: opts.session,
        roomCode: opts.room,
        name: opts.name || 'Hero',
        heroId: opts.hero || 'H-01',
        keepCoach: Boolean(opts['keep-coach']),
        waitStart: opts['no-wait-start'] ? false : true,
      });
      console.log(JSON.stringify(data, null, 2));
      break;
    }
    case 'host': {
      let viewport = { width: 1440, height: 900 };
      if (opts.viewport) {
        const [w, h] = String(opts.viewport).split('x').map(Number);
        if (w && h) viewport = { width: w, height: h };
      }
      const data = await post('/host', {
        sessionId: opts.session,
        name: opts.name || 'Dealer',
        batchId: opts.batch || null,
        tester: opts.tester || null,
        monitor: Boolean(opts.monitor),
        viewport,
      });
      console.log(JSON.stringify(data, null, 2));
      break;
    }
    case 'state': {
      console.log(JSON.stringify(await post('/state', { sessionId: opts.session }), null, 2));
      break;
    }
    case 'act': {
      console.log(
        JSON.stringify(
          await post('/act', {
            sessionId: opts.session,
            selector: opts.selector,
            value: opts.value,
            select: opts.select,
          }),
          null,
          2,
        ),
      );
      break;
    }
    case 'auto-step': {
      console.log(
        JSON.stringify(
          await post('/auto-step', {
            sessionId: opts.session,
            steps: Number(opts.steps || 15),
            autoModals: Boolean(opts['auto-modals']),
            targetFloors: Number(opts['target-floors'] || 1),
          }),
          null,
          2,
        ),
      );
      break;
    }
    case 'screenshot': {
      let width;
      let height;
      if (opts.viewport) {
        const [w, h] = String(opts.viewport).split('x').map(Number);
        width = w;
        height = h;
      }
      console.log(
        JSON.stringify(
          await post('/screenshot', {
            sessionId: opts.session,
            outPath: opts.out,
            width,
            height,
          }),
          null,
          2,
        ),
      );
      break;
    }
    case 'audit': {
      console.log(JSON.stringify(await post('/audit', { sessionId: opts.session }), null, 2));
      break;
    }
    case 'close': {
      console.log(JSON.stringify(await post('/close', { sessionId: opts.session }), null, 2));
      break;
    }
    default:
      console.error('Usage: node scripts/playtest/hero-cli.mjs <join|host|state|act|auto-step|screenshot|audit|close> --session <id> ...');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
