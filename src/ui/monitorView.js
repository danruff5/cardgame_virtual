import './monitor.css';

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function fmtDuration(sec) {
  const s = Number(sec || 0);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function fmtAge(ts) {
  if (!ts) return '—';
  const diff = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (diff < 60) return `${diff}s ago`;
  return `${Math.floor(diff / 60)}m ago`;
}

export function mountMonitorView(rootEl) {
  let sourceTab = 'overall'; // overall | ui | sim
  let autoRefresh = true;
  let timer = null;
  let lastData = null;
  let fetchError = '';

  async function refresh() {
    try {
      const res = await fetch('/api/telemetry/summary');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      lastData = await res.json();
      fetchError = '';
    } catch (err) {
      fetchError = err.message || 'Telemetry endpoint unavailable (dev server required).';
    }
    paint();
  }

  function paint() {
    const bucket = lastData?.[sourceTab] || lastData?.overall || null;
    const activeList = lastData?.activeList || [];
    const recentGames = lastData?.recentGames || [];
    const ticketsV = lastData?.tickets?.virtual || [];
    const ticketsR = lastData?.tickets?.rules || [];

    const kpisHtml = bucket
      ? `
        <div class="monitor-kpis">
          <div class="monitor-kpi">
            <div class="monitor-kpi-label">Active Games</div>
            <div class="monitor-kpi-val">${bucket.activeGames + bucket.lobbyGames}</div>
            <div class="monitor-kpi-sub">${bucket.activeGames} playing · ${bucket.lobbyGames} lobby</div>
          </div>
          <div class="monitor-kpi">
            <div class="monitor-kpi-label">Total Played</div>
            <div class="monitor-kpi-val">${bucket.totalCompleted}</div>
            <div class="monitor-kpi-sub">${bucket.totalStarted} started · ${bucket.abandoned} abandoned</div>
          </div>
          <div class="monitor-kpi">
            <div class="monitor-kpi-label">Win / Loss</div>
            <div class="monitor-kpi-val">${bucket.wins}W / ${bucket.losses}L</div>
            <div class="monitor-kpi-sub">Win rate: <strong>${bucket.winRatePct}%</strong> · Boss kill: ${bucket.bossDefeatRatePct}%</div>
          </div>
          <div class="monitor-kpi">
            <div class="monitor-kpi-label">Skirmish Length</div>
            <div class="monitor-kpi-val">${bucket.avgClashLength}</div>
            <div class="monitor-kpi-sub">exchanges/clash (target 3–5)</div>
          </div>
          <div class="monitor-kpi">
            <div class="monitor-kpi-label">Desperation / Floor</div>
            <div class="monitor-kpi-val">${bucket.avgDesperationPerFloor}</div>
            <div class="monitor-kpi-sub">Downed/floor: ${bucket.avgDownedPerFloor} · Hoard 6+: ${bucket.hoard6PlusPct}%</div>
          </div>
          <div class="monitor-kpi">
            <div class="monitor-kpi-label">Tickets Logged</div>
            <div class="monitor-kpi-val">${ticketsV.length} / ${ticketsR.length}</div>
            <div class="monitor-kpi-sub">virtual_# / rules_#</div>
          </div>
        </div>
      `
      : '';

    const checklist = bucket?.checklistTargets;
    const checklistHtml = checklist
      ? `
        <div class="monitor-card">
          <h2>Playtest Checklist Targets vs Observed</h2>
          <div class="monitor-table-wrap">
            <table class="monitor-table">
              <thead><tr><th>Metric</th><th>Target (playtest_checklist.md)</th><th>Observed</th><th>Status</th></tr></thead>
              <tbody>
                <tr>
                  <td>1v1 Skirmish Length</td>
                  <td>${esc(checklist.skirmishLength.target)}</td>
                  <td><strong>${checklist.skirmishLength.actual}</strong> exchanges</td>
                  <td><span class="monitor-badge ${checklist.skirmishLength.ok ? 'ok' : 'warn'}">${checklist.skirmishLength.ok ? 'On Target' : 'Review'}</span></td>
                </tr>
                <tr>
                  <td>Desperation Flips / Floor</td>
                  <td>${esc(checklist.desperationPerFloor.target)}</td>
                  <td><strong>${checklist.desperationPerFloor.actual}</strong> flips</td>
                  <td><span class="monitor-badge ${checklist.desperationPerFloor.ok ? 'ok' : 'warn'}">${checklist.desperationPerFloor.ok ? 'On Target' : 'Review'}</span></td>
                </tr>
                <tr>
                  <td>Times Hero Hit DOWNED</td>
                  <td>${esc(checklist.downedPerFloor.target)}</td>
                  <td><strong>${checklist.downedPerFloor.actual}</strong> knocks</td>
                  <td><span class="monitor-badge ${checklist.downedPerFloor.ok ? 'ok' : 'warn'}">${checklist.downedPerFloor.ok ? 'On Target' : 'Review'}</span></td>
                </tr>
                <tr>
                  <td>6+ Card Hand Hoarding</td>
                  <td>${esc(checklist.hoard6PlusPct.target)}</td>
                  <td><strong>${checklist.hoard6PlusPct.actual}%</strong> of games</td>
                  <td><span class="monitor-badge ${checklist.hoard6PlusPct.ok ? 'ok' : 'warn'}">${checklist.hoard6PlusPct.ok ? 'Observed' : 'None yet'}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      `
      : '';

    const partyRows = Object.entries(bucket?.byPartySize || {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([k, v]) => `
        <div class="monitor-bar-row">
          <span><strong>${esc(k)}</strong> (${v.played} games)</span>
          <div class="monitor-bar-track"><div class="monitor-bar-fill" style="width:${v.winRatePct}%"></div></div>
          <span>${v.winRatePct}% W · ${v.avgDesp}d</span>
        </div>`,
      )
      .join('');

    const heroRows = Object.entries(bucket?.byHero || {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([id, h]) => `
        <div class="monitor-bar-row">
          <span><strong>${esc(h.name || id)}</strong> (${h.played})</span>
          <div class="monitor-bar-track"><div class="monitor-bar-fill" style="width:${h.winRatePct}%"></div></div>
          <span>${h.winRatePct}% W · ${h.avgFinalHp}hp</span>
        </div>`,
      )
      .join('');

    const monsterRows = Object.entries(bucket?.byMonster || {})
      .sort(([, a], [, b]) => (b.isBoss ? 1 : 0) - (a.isBoss ? 1 : 0) || b.fights - a.fights)
      .map(
        ([id, m]) => `
        <tr>
          <td>${m.isBoss ? '👑 ' : ''}${esc(m.name || id)}</td>
          <td>${m.fights}</td>
          <td>${m.heroWinPct}%</td>
          <td>${m.lost}</td>
          <td>${m.avgExchanges}</td>
        </tr>`,
      )
      .join('');

    const activeRows = activeList
      .map(
        (g) => `
        <tr>
          <td><strong>${esc(g.roomCode)}</strong></td>
          <td>${esc(g.source)}</td>
          <td>${esc(g.batchId || '—')}</td>
          <td>${g.heroCount}P (${esc((g.heroIds || []).join(', '))})</td>
          <td>${esc(g.phase)}</td>
          <td>${g.explorationTurns || 0}</td>
          <td>${g.clashesTotal || 0}</td>
          <td>${fmtAge(g.updatedAt)}</td>
        </tr>`,
      )
      .join('');

    const recentRows = recentGames
      .slice(0, 25)
      .map(
        (g) => `
        <tr>
          <td><strong>${esc(g.roomCode)}</strong></td>
          <td>${esc(g.source)}</td>
          <td>${esc(g.batchId || '—')}</td>
          <td>${g.heroCount}P</td>
          <td>${esc(g.bossId || '—')}</td>
          <td><span class="monitor-badge ${esc(g.effectiveStatus)}">${esc(g.effectiveStatus)}</span></td>
          <td>${g.explorationTurns || 0}</td>
          <td>${g.clashesWon || 0}/${g.clashesTotal || 0}</td>
          <td>${g.desperationFlips || 0}</td>
          <td>${g.heroDownedCount || 0}</td>
          <td>${fmtDuration(g.durationSec)}</td>
        </tr>`,
      )
      .join('');

    const renderTicketList = (list) =>
      list.length
        ? list
            .map(
              (t) => `
          <div class="monitor-ticket">
            <div class="monitor-ticket-head">
              <span class="monitor-ticket-id">${esc(t.id)} · ${esc(t.area || '')}</span>
              <span class="monitor-badge ${esc(t.severity)}">${esc(t.severity)}</span>
            </div>
            <strong>${esc(t.title)}</strong>
            ${t.summary ? `<p class="monitor-ticket-body">${esc(t.summary)}</p>` : ''}
            ${t.evidence ? `<p class="monitor-ticket-body" style="opacity:0.7"><em>${esc(t.evidence)}</em></p>` : ''}
          </div>`,
            )
            .join('')
        : '<p class="muted">No tickets logged yet.</p>';

    rootEl.innerHTML = `
      <div class="monitor-shell">
        <div class="monitor-head">
          <div class="monitor-title-wrap">
            <h1>Playtest Monitor — Cozy Basement Crawl</h1>
            <p>Live telemetry across UI playtests and headless simulations · ${lastData ? `Updated ${fmtAge(lastData.updatedAt)}` : 'Loading…'}</p>
          </div>
          <div class="monitor-controls">
            <span class="monitor-live-pill">
              <span class="monitor-dot ${autoRefresh ? 'is-active' : ''}"></span>
              ${autoRefresh ? 'Live 2s' : 'Paused'}
            </span>
            <div class="monitor-tabs">
              <button type="button" class="monitor-tab ${sourceTab === 'overall' ? 'is-selected' : ''}" data-mon-tab="overall">All</button>
              <button type="button" class="monitor-tab ${sourceTab === 'ui' ? 'is-selected' : ''}" data-mon-tab="ui">UI Playtests</button>
              <button type="button" class="monitor-tab ${sourceTab === 'sim' ? 'is-selected' : ''}" data-mon-tab="sim">Headless Sims</button>
            </div>
            <button type="button" id="mon-toggle-auto">${autoRefresh ? 'Pause' : 'Resume'}</button>
            <button type="button" id="mon-refresh">Refresh</button>
            <a class="monitor-link-pill" href="./">← Back to Game</a>
          </div>
        </div>
        ${fetchError ? `<div class="monitor-card" style="border-color:rgba(217,72,59,0.5)"><strong>Telemetry error:</strong> ${esc(fetchError)}</div>` : ''}
        ${kpisHtml}
        <div class="monitor-grid-2">
          <div>${checklistHtml}</div>
          <div class="monitor-card">
            <h2>Win Rate by Party Size &amp; Hero</h2>
            ${partyRows || '<p class="muted">No completed games yet.</p>'}
            <hr style="border:0;border-top:1px solid rgba(255,255,255,0.08);margin:0.6rem 0" />
            ${heroRows || '<p class="muted">No hero data yet.</p>'}
          </div>
        </div>
        <div class="monitor-grid-2">
          <div class="monitor-card">
            <h2>Active &amp; Lobby Games (${activeList.length})</h2>
            <div class="monitor-table-wrap">
              <table class="monitor-table">
                <thead><tr><th>Room</th><th>Source</th><th>Batch</th><th>Party</th><th>Phase</th><th>Turns</th><th>Clashes</th><th>Ping</th></tr></thead>
                <tbody>${activeRows || '<tr><td colspan="8" class="muted">No active games right now.</td></tr>'}</tbody>
              </table>
            </div>
          </div>
          <div class="monitor-card">
            <h2>Monster &amp; Boss Lethality</h2>
            <div class="monitor-table-wrap">
              <table class="monitor-table">
                <thead><tr><th>Enemy</th><th>Fights</th><th>Hero Win%</th><th>Downs</th><th>Avg Exch</th></tr></thead>
                <tbody>${monsterRows || '<tr><td colspan="5" class="muted">No clash data yet.</td></tr>'}</tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="monitor-card">
          <h2>Recent Completed Games</h2>
          <div class="monitor-table-wrap">
            <table class="monitor-table">
              <thead><tr><th>Room</th><th>Source</th><th>Batch</th><th>Party</th><th>Boss</th><th>Result</th><th>Turns</th><th>Clashes</th><th>Desp</th><th>Downed</th><th>Time</th></tr></thead>
              <tbody>${recentRows || '<tr><td colspan="11" class="muted">No completed games yet.</td></tr>'}</tbody>
            </table>
          </div>
        </div>
        <div class="monitor-grid-2">
          <div class="monitor-card">
            <h2>UI / Implementation Tickets (virtual_#) <span>${ticketsV.length}</span></h2>
            <div class="monitor-ticket-list">${renderTicketList(ticketsV)}</div>
          </div>
          <div class="monitor-card">
            <h2>Game Design Recommendations (rules_#) <span>${ticketsR.length}</span></h2>
            <div class="monitor-ticket-list">${renderTicketList(ticketsR)}</div>
          </div>
        </div>
      </div>
    `;

    rootEl.querySelectorAll('[data-mon-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        sourceTab = btn.getAttribute('data-mon-tab');
        paint();
      });
    });
    rootEl.querySelector('#mon-refresh')?.addEventListener('click', refresh);
    rootEl.querySelector('#mon-toggle-auto')?.addEventListener('click', () => {
      autoRefresh = !autoRefresh;
      if (autoRefresh) startTimer();
      else stopTimer();
      paint();
    });
  }

  function startTimer() {
    stopTimer();
    timer = setInterval(refresh, 2000);
  }
  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  paint();
  refresh();
  startTimer();

  return () => stopTimer();
}
