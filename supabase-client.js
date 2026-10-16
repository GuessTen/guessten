/* Daily Ten — Supabase integration: live scores, standings, streaks */
(function () {
  const ROSTER = ['Jake', 'Kevin', 'Alex', 'Joey'];
  const ROSTER_IDS = { 'Jake': 'jake', 'Kevin': 'kevin', 'Alex': 'alex', 'Joey': 'joey' };
  const ROSTER_IDS_INV = { 'jake': 'Jake', 'kevin': 'Kevin', 'alex': 'Alex', 'joey': 'Joey' };

  let client = null;
  let realtimeChannel = null;
  const listeners = { today: [], season: [] };

  function configured() {
    const c = window.DAILY_TEN_CONFIG || {};
    return c.SUPABASE_URL && !c.SUPABASE_URL.includes('YOUR_PROJECT_REF') && c.SUPABASE_ANON_KEY && !c.SUPABASE_ANON_KEY.includes('YOUR_ANON');
  }

  function init() {
    if (!configured() || typeof window.supabase === 'undefined') return false;
    if (!client) {
      client = window.supabase.createClient(
        window.DAILY_TEN_CONFIG.SUPABASE_URL,
        window.DAILY_TEN_CONFIG.SUPABASE_ANON_KEY
      );
    }
    return true;
  }

  function isReady() { return !!client; }

  // Insert a finished score. Returns {ok, error}.
  async function submitScore({ player, day, puzzleNumber, category, score, guessesUsed, revealed, guessedRanks }) {
    if (!client) return { ok: false, error: 'Supabase not configured' };
    const row = {
      player_id: ROSTER_IDS[player],
      day: day,
      puzzle_number: puzzleNumber,
      category: category,
      score: score,
      guesses_used: guessesUsed,
      revealed: revealed
    };
    // guessed_ranks column is optional (requires migration)
    if (guessedRanks && guessedRanks.length) row.guessed_ranks = guessedRanks.join(',');
    let { error } = await client.from('scores').upsert(row, { onConflict: 'player_id,day' });
    // if the column doesn't exist yet, retry without it
    if (error && /guessed_ranks/.test(error.message)) {
      delete row.guessed_ranks;
      ({ error } = await client.from('scores').upsert(row, { onConflict: 'player_id,day' }));
    }
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  // Fetch one player's submitted score for a day (for replay lockout).
  async function fetchPlayerScore(playerId, dayISO) {
    if (!client) return null;
    const { data, error } = await client.from('scores')
      .select('*').eq('player_id', playerId).eq('day', dayISO).limit(1);
    if (error || !data || !data.length) return null;
    return data[0];
  }

  // Fetch all scores (for standings). Optionally since a date.
  async function fetchScores() {
    if (!client) return [];
    const { data, error } = await client.from('scores').select('*').order('day', { ascending: true });
    if (error) { console.error('fetchScores:', error.message); return []; }
    return data || [];
  }

  // Fetch past seasons (champions history). Returns [] if the table doesn't exist yet.
  async function fetchSeasons() {
    if (!client) return [];
    const { data, error } = await client.from('seasons').select('*').order('season_number', { ascending: false });
    if (error) { console.log('fetchSeasons:', error.message); return []; }
    return data || [];
  }

  // Fetch today's scores.
  async function fetchToday(dayISO) {
    if (!client) return [];
    const { data, error } = await client.from('scores').select('*').eq('day', dayISO).order('created_at', { ascending: true });
    if (error) { console.error('fetchToday:', error.message); return []; }
    return data || [];
  }

  // Subscribe to realtime score changes. cb receives the full today list each time.
  async function subscribeToday(dayISO, cb) {
    if (!client) return;
    if (realtimeChannel) { client.removeChannel(realtimeChannel); realtimeChannel = null; }
    const refresh = async () => cb(await fetchToday(dayISO));
    realtimeChannel = client.channel('scores-today')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores', filter: `day=eq.${dayISO}` }, refresh)
      .subscribe();
    await refresh();
  }

  function unsubscribe() {
    if (client && realtimeChannel) { client.removeChannel(realtimeChannel); realtimeChannel = null; }
  }

  /* ---- Standings math (mirrors league rules) ---- */

  // Group scores by day. Returns { dayISO: [scoreRows] }
  function groupByDay(scores) {
    const map = {};
    for (const s of scores) {
      (map[s.day] = map[s.day] || []).push(s);
    }
    return map;
  }

  // Head-to-head: for each pair of players, count days where one beat the other.
  // Only counts days where both played. Win = higher score, tiebreak fewer guesses.
  // Revealed = automatic loss for that player that day.
  function computeHeadToHead(scores) {
    const byDay = groupByDay(scores);
    const h2h = {};
    for (const a of ROSTER) {
      h2h[a] = {};
      for (const b of ROSTER) h2h[a][b] = { w: 0, l: 0, t: 0 };
    }
    for (const day of Object.keys(byDay)) {
      const rows = byDay[day];
      const byPid = {};
      for (const r of rows) {
        const name = ROSTER_IDS_INV[r.player_id] || r.player_id;
        if (!byPid[name] || r.score > byPid[name].score ||
            (r.score === byPid[name].score && r.guesses_used < byPid[name].guesses_used)) {
          byPid[name] = r;
        }
      }
      const names = Object.keys(byPid);
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const A = byPid[names[i]], B = byPid[names[j]];
          const aRev = A.revealed, bRev = B.revealed;
          let result; // 1 = A wins, -1 = B wins, 0 = tie
          if (aRev && !bRev) result = -1;
          else if (bRev && !aRev) result = 1;
          else if (A.score > B.score) result = 1;
          else if (B.score > A.score) result = -1;
          else if (A.guesses_used < B.guesses_used) result = 1;
          else if (B.guesses_used < A.guesses_used) result = -1;
          else result = 0;
          const na = names[i], nb = names[j];
          if (result === 1) { h2h[na][nb].w++; h2h[nb][na].l++; }
          else if (result === -1) { h2h[na][nb].l++; h2h[nb][na].w++; }
          else { h2h[na][nb].t++; h2h[nb][na].t++; }
        }
      }
    }
    return h2h;
  }

  // For one day's rows (needs all 4 to count): returns { winnerIds[], tied: bool }
  // revealed = automatic loss. Best = highest score, tiebreak fewest guesses.
  function judgeDay(rows) {
    const byPlayer = {};
    for (const r of rows) {
      const pid = r.player_id;
      if (!byPlayer[pid] || r.score > byPlayer[pid].score ||
          (r.score === byPlayer[pid].score && r.guesses_used < byPlayer[pid].guesses_used)) {
        byPlayer[pid] = r;
      }
    }
    const pids = Object.keys(byPlayer);
    if (pids.length < 4) return null; // day doesn't count yet
    // revealed players can't win
    const eligible = pids.filter(pid => !byPlayer[pid].revealed);
    const pool = eligible.length ? eligible : pids;
    let best = -1, bestG = Infinity;
    for (const pid of pool) {
      const r = byPlayer[pid];
      if (r.score > best || (r.score === best && r.guesses_used < bestG)) {
        best = r.score; bestG = r.guesses_used;
      }
    }
    const winners = pool.filter(pid => byPlayer[pid].score === best && byPlayer[pid].guesses_used === bestG);
    return { winners, tied: winners.length > 1, rows: byPlayer };
  }

  // Compute season W-L-T + total score per player.
  function computeStandings(scores) {
    const table = {};
    for (const name of ROSTER) table[name] = { wins: 0, losses: 0, ties: 0, totalScore: 0, daysPlayed: 0 };
    const idToName = { jake: 'Jake', kevin: 'Kevin', alex: 'Alex', joey: 'Joey' };
    const byDay = groupByDay(scores);
    const days = Object.keys(byDay).sort();
    for (const day of days) {
      const verdict = judgeDay(byDay[day]);
      if (!verdict) continue;
      for (const pid of Object.keys(verdict.rows)) {
        const name = idToName[pid];
        if (!name) continue;
        const r = verdict.rows[pid];
        table[name].daysPlayed++;
        table[name].totalScore += r.score;
        if (r.revealed) { table[name].losses++; continue; }
        if (verdict.winners.includes(pid)) {
          if (verdict.tied) table[name].ties++;
          else table[name].wins++;
        } else {
          table[name].losses++;
        }
      }
    }
    return table;
  }

  // Current win/loss streak per player (most recent counted days, chronological).
  function computeStreaks(scores) {
    const idToName = { jake: 'Jake', kevin: 'Kevin', alex: 'Alex', joey: 'Joey' };
    const byDay = groupByDay(scores);
    const days = Object.keys(byDay).sort();
    const streaks = {};
    for (const name of ROSTER) streaks[name] = { type: null, count: 0 };
    for (const day of days) {
      const verdict = judgeDay(byDay[day]);
      if (!verdict) continue;
      for (const pid of Object.keys(verdict.rows)) {
        const name = idToName[pid];
        if (!name) continue;
        const r = verdict.rows[pid];
        let result;
        if (r.revealed) result = 'L';
        else if (verdict.winners.includes(pid)) result = verdict.tied ? 'T' : 'W';
        else result = 'L';
        if (result === 'T') continue; // ties don't break or extend streaks
        const st = streaks[name];
        if (st.type === result) st.count++;
        else { st.type = result; st.count = 1; }
      }
    }
    return streaks;
  }

  async function savePushSubscription(playerId, subscriptionJson) {
    if (!client) return { ok: false, error: 'Supabase not configured' };
    const { error } = await client.from('push_subscriptions').upsert(
      { player_id: playerId, subscription: subscriptionJson, updated_at: new Date().toISOString() },
      { onConflict: 'player_id' }
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  window.DTDB = {
    ROSTER, ROSTER_IDS,
    configured, init, isReady,
    submitScore, fetchScores, fetchToday, fetchPlayerScore,
    subscribeToday, unsubscribe,
    computeStandings, computeStreaks, judgeDay, groupByDay,
    computeHeadToHead, savePushSubscription, fetchSeasons
  };
})();
