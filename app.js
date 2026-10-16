/* The Daily Ten — game logic */
(function () {
  'use strict';

  const ROSTER = ['Jake', 'Kevin', 'Alex', 'Joey'];
  const EPOCH_ISO = '2026-10-16'; // Category rotation start (America/Chicago)
  const QUIZ_EPOCH_ISO = '2026-10-17'; // Official Quiz 1 (trial day Oct 16 wiped)
  const MAX_GUESSES = 15;

  // ---------- Date / day ----------
  function chicagoTodayISO() {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
    return fmt.format(new Date());
  }
  function dayIndexFor(iso) {
    const ms = Date.parse(iso + 'T12:00:00') - Date.parse(EPOCH_ISO + 'T12:00:00');
    return Math.floor(ms / 86400000);
  }
  function categoryForDay(idx) {
    const cats = window.DAILY_TEN_CATEGORIES;
    const n = cats.length;
    // Quiz number: Oct 17 (idx=1) = Quiz 1. Oct 16 (idx=0) was the trial.
    return { cat: cats[((idx % n) + n) % n], puzzleNumber: idx };
  }

  // ---------- State ----------
  let player = null;
  let dayISO = chicagoTodayISO();
  let dayIdx = dayIndexFor(dayISO);
  let puzzle = categoryForDay(dayIdx);
  let guessed = {};        // rank -> item
  let wrongGuesses = [];   // strings
  let outsideHits = [];    // {name, rank}
  let guessesUsed = 0;
  let revealed = false;
  let finished = false;
  let submitted = false;

  const $ = (id) => document.getElementById(id);

  // ---------- URL autosave ----------
  function saveToURL() {
    const p = new URLSearchParams();
    if (player) p.set('player', player);
    p.set('day', dayISO);
    const g = Object.keys(guessed).sort((a, b) => a - b).join(',');
    if (g) p.set('g', g);
    if (wrongGuesses.length) p.set('w', wrongGuesses.map(encodeURIComponent).join(','));
    if (outsideHits.length) p.set('o', outsideHits.map(h => h.rank + ':' + encodeURIComponent(h.name)).join(','));
    if (revealed) p.set('r', '1');
    if (finished) p.set('f', '1');
    p.set('gu', String(guessesUsed));
    history.replaceState(null, '', '?' + p.toString());
    saveToStorage();
  }

  // Backup save to localStorage (survives browser app being killed)
  function saveToStorage() {
    try {
      const data = {
        player, day: dayISO,
        g: Object.keys(guessed).map(Number),
        w: wrongGuesses, o: outsideHits,
        r: revealed, f: finished, gu: guessesUsed
      };
      localStorage.setItem('guessten-progress', JSON.stringify(data));
    } catch (e) { /* storage unavailable */ }
  }

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem('guessten-progress');
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (data.day !== dayISO || !ROSTER.includes(data.player)) return false;
      const byRank = {};
      for (const it of puzzle.cat.items) byRank[it.rank] = it;
      guessed = {};
      (data.g || []).forEach(r => { if (byRank[r]) guessed[r] = byRank[r]; });
      wrongGuesses = data.w || [];
      outsideHits = data.o || [];
      revealed = !!data.r;
      finished = !!data.f;
      player = data.player;
      guessesUsed = Number.isFinite(data.gu) ? data.gu
        : Object.keys(guessed).length + wrongGuesses.length + outsideHits.length;
      return true;
    } catch (e) { return false; }
  }

  function clearStorage() {
    try { localStorage.removeItem('guessten-progress'); } catch (e) {}
  }

  function loadFromURL() {
    const p = new URLSearchParams(location.search);
    if (p.get('day') !== dayISO) return false; // yesterday's state never restores
    const pl = p.get('player');
    if (pl && ROSTER.includes(pl)) player = pl;
    else return false;
    const byRank = {};
    for (const it of puzzle.cat.items) byRank[it.rank] = it;
    (p.get('g') || '').split(',').filter(Boolean).forEach(r => {
      const it = byRank[parseInt(r, 10)];
      if (it) guessed[it.rank] = it;
    });
    wrongGuesses = (p.get('w') || '').split(',').filter(Boolean).map(decodeURIComponent);
    outsideHits = (p.get('o') || '').split(',').filter(Boolean).map(s => {
      const i = s.indexOf(':');
      return { rank: parseInt(s.slice(0, i), 10), name: decodeURIComponent(s.slice(i + 1)) };
    });
    revealed = p.get('r') === '1';
    finished = p.get('f') === '1';
    // guessesUsed is persisted explicitly (correct answers count except in sudden death)
    const guParam = parseInt(p.get('gu'), 10);
    guessesUsed = Number.isFinite(guParam) ? guParam
      : Object.keys(guessed).length + wrongGuesses.length + outsideHits.length;
    return true;
  }

  // ---------- Progress code ----------
  function encodeProgress() {
    const data = { v: 1, player, day: dayISO, g: Object.keys(guessed).map(Number), w: wrongGuesses, o: outsideHits, r: revealed, f: finished, gu: guessesUsed };
    return btoa(unescape(encodeURIComponent(JSON.stringify(data)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeProgress(code) {
    try {
      const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
      const data = JSON.parse(decodeURIComponent(escape(atob(b64))));
      if (data.day !== dayISO || !ROSTER.includes(data.player)) return false;
      const byRank = {};
      for (const it of puzzle.cat.items) byRank[it.rank] = it;
      guessed = {};
      (data.g || []).forEach(r => { if (byRank[r]) guessed[r] = byRank[r]; });
      wrongGuesses = data.w || [];
      outsideHits = data.o || [];
      revealed = !!data.r;
      finished = !!data.f;
      player = data.player;
      // correct top-10 answers don't consume guesses
      guessesUsed = Number.isFinite(data.gu) ? data.gu
        : Object.keys(guessed).length + wrongGuesses.length + outsideHits.length;
      return true;
    } catch (e) { return false; }
  }

  // ---------- Name picker ----------
  let pendingName = null;
  function showPicker() {
    $('name-picker').classList.remove('hidden');
    $('game-area').classList.add('hidden');
    const opts = $('name-options');
    opts.innerHTML = '';
    ROSTER.forEach(n => {
      const b = document.createElement('button');
      b.className = 'name-option';
      b.innerHTML = `<img src="avatars/${n.toLowerCase()}.webp" alt="${n}" class="avatar-pick" /><span>${n}</span>`;
      b.onclick = () => { pendingName = n; $('confirm-name').textContent = n; $('name-confirm').classList.remove('hidden'); };
      opts.appendChild(b);
    });
  }
  function hidePicker() { $('name-picker').classList.add('hidden'); }

  // ---------- Board ----------
  function renderBoard() {
    const board = $('board');
    board.innerHTML = '';
    for (let r = 1; r <= 10; r++) {
      const row = document.createElement('div');
      row.className = 'board-row' + (guessed[r] ? ' filled' : '');
      const it = guessed[r];
      row.innerHTML = `<span class="rank">${r}</span>` +
        (it ? `<span class="answer">${escapeHtml(it.name)}</span>` : `<span class="empty">—</span>`);
      board.appendChild(row);
    }
    const left = MAX_GUESSES - guessesUsed;
    $('guesses-left').textContent = finished ? '' : `${left} guess${left === 1 ? '' : 'es'} left`;
    // outside top-ten hits, sorted numerically by rank
    const oh = $('outside-top-ten');
    oh.innerHTML = '';
    outsideHits.slice().sort((a, b) => a.rank - b.rank).forEach(h => {
      const d = document.createElement('div');
      d.className = 'outside-hit';
      d.textContent = `${h.name} — #${h.rank} (outside the top 10)`;
      oh.appendChild(d);
    });
  }

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // ---------- Dropdown ----------
  const input = $('guess-input');
  const dropdown = $('dropdown');
  let suppressDropdown = false;

  function norm(s) { return s.toLowerCase().trim(); }

  function fuzzyMatch(q, target) {
    // subsequence match
    let qi = 0;
    for (let i = 0; i < target.length && qi < q.length; i++) {
      if (target[i] === q[qi]) qi++;
    }
    return qi === q.length;
  }

  function getSuggestions(q) {
    q = norm(q);
    if (!q) return [];
    // filter out everything already guessed: correct, outside-top-10, and wrong
    const guessedNames = new Set(Object.values(guessed).map(i => norm(i.name)));
    outsideHits.forEach(h => guessedNames.add(norm(h.name)));
    wrongGuesses.forEach(w => guessedNames.add(norm(w)));
    const out = [];
    for (const it of puzzle.cat.items) {
      if (guessedNames.has(norm(it.name))) continue;
      const name = norm(it.name);
      const aliases = (it.aliases || []).map(norm);
      let score = -1;
      if (name.startsWith(q)) score = 0;
      else if (aliases.some(a => a.startsWith(q))) score = 1;
      else if (name.includes(q) || aliases.some(a => a.includes(q))) score = 2;
      else if (fuzzyMatch(q, name) || aliases.some(a => fuzzyMatch(q, a))) score = 3;
      if (score >= 0) out.push({ it, score });
    }
    out.sort((a, b) => a.score - b.score || a.it.name.localeCompare(b.it.name));
    return out.slice(0, 8).map(x => x.it);
  }

  function renderDropdown(items) {
    dropdown.innerHTML = '';
    if (!items.length) { dropdown.classList.add('hidden'); return; }
    items.forEach(it => {
      const d = document.createElement('div');
      d.className = 'dropdown-item';
      d.textContent = it.name;
      // tap-only selection: use touchend/click, ignore swipe
      let touchY = null;
      d.addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
      d.addEventListener('touchend', (e) => {
        const dy = Math.abs(e.changedTouches[0].clientY - touchY);
        if (dy < 10) { e.preventDefault(); selectGuess(it); }
      });
      d.addEventListener('click', () => selectGuess(it));
      dropdown.appendChild(d);
    });
    dropdown.classList.remove('hidden');
  }

  input.addEventListener('input', () => {
    if (suppressDropdown) { suppressDropdown = false; return; }
    renderDropdown(getSuggestions(input.value));
  });
  input.addEventListener('focus', () => renderDropdown(getSuggestions(input.value)));
  document.addEventListener('click', (e) => {
    if (!$('input-wrap').contains(e.target)) dropdown.classList.add('hidden');
  });

  // ---------- Guessing ----------
  function findItem(name) {
    const q = norm(name);
    for (const it of puzzle.cat.items) {
      if (norm(it.name) === q) return it;
      if ((it.aliases || []).some(a => norm(a) === q)) return it;
    }
    return null;
  }

  // ---------- Mascot reactions ----------
  const MASCOT_HAPPY = [
    "Nice! That's the stuff!",
    "You're on fire!",
    "Beautiful!",
    "Textbook!",
    "The mustache approves!"
  ];
  const MASCOT_CLOSE = [
    "So close!",
    "Just missed it!",
    "Ouch — right outside!",
    "The cane almost dropped on that one!"
  ];
  const MASCOT_ROAST = [
    "Did you even try, you dumbass?",
    "My grandmother got that one and she's dead.",
    "Yikes. Just... fucking yikes.",
    "The top hat is disappointed in you.",
    "That was... a choice. A shit one.",
    "Bold strategy. Fucking terrible, but bold.",
    "What the fuck was that?",
    "Are you fucking kidding me right now?",
    "Jesus Christ, that was awful.",
    "I'd roast you but the answers already did.",
    "Do you even know what a top 10 is, moron?",
    "That guess was absolute dogshit.",
    "The cane just filed for divorce.",
    "Holy shit, that was bad.",
    "I've seen better guesses from a drunk toddler.",
    "You play like you're trying to lose.",
    "That was so bad I felt it in my mustache.",
    "Were you dropped on your head as a child?",
    "Congratulations, that's the dumbest shit I've heard today.",
    "You couldn't guess your way out of a paper bag."
  ];
  const MASCOT_BRUTAL = [
    "You're fucking embarrassing yourself.",
    "I've seen smarter moves from a concussed pigeon.",
    "This is painful to watch. Genuinely fucking painful.",
    "Are you doing this on purpose? You have to be.",
    "Fucking hell. Just... fucking hell.",
    "Your brain called, it wants a refund.",
    "I'd tell you to try harder but I'm not sure you can.",
    "This is the worst shit I've ever seen.",
    "You absolute fucking donkey.",
    "Did your parents have any children that lived?",
    "I'm dumber just from watching you play.",
    "You guess like someone who's never had a thought.",
    "Fuck me, that was atrocious.",
    "I'd rather watch paint dry than watch you play again.",
    "You're the reason the top hat drinks."
  ];
  const MASCOT_SUDDEN_DEATH = [
    "Sudden death! No pressure...",
    "One guess left. The mustache is sweating.",
    "This is where legends are made. Or broken."
  ];

  let speechTimer = null;
  function mascotSay(text) {
    const el = $('mascot-speech');
    el.textContent = text;
    el.classList.remove('hidden');
    positionSpeech();
    // re-trigger animation
    el.style.animation = 'none';
    el.offsetHeight;
    el.style.animation = '';
    if (speechTimer) clearTimeout(speechTimer);
    speechTimer = setTimeout(() => el.classList.add('hidden'), 4000);
  }

  // Mascot sits in header below the title (in-flow, not fixed)
  // Speech bubble positions relative to the mascot's position in the header
  function positionSpeech() {
    const speech = $('mascot-speech');
    if (speech.classList.contains('hidden')) return;
    const cloud = document.getElementById('mascot-cloud');
    const rect = cloud.getBoundingClientRect();
    // speech cloud above the mascot, centered
    speech.style.left = Math.max(10, rect.left + window.scrollX + rect.width / 2 - 110) + 'px';
    speech.style.top = Math.max(10, rect.top + window.scrollY - 60) + 'px';
  }
  // tapping him makes him wiggle and say something
  mascotEl.addEventListener('click', () => {
    const greetings = ["Hey!", "What's up?", "I'm watching...", "Make me proud.", "The mustache sees all."];
    mascotSay(greetings[Math.floor(Math.random() * greetings.length)]);
  });
  function mascotReact(type) {
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    if (type === 'happy') mascotSay(pick(MASCOT_HAPPY));
    else if (type === 'close') mascotSay(pick(MASCOT_CLOSE));
    else if (type === 'roast') {
      // go brutal if they're playing really badly (3+ wrong, 2 or fewer correct)
      const bad = wrongGuesses.length >= 3 && score() <= 2;
      mascotSay(pick(bad ? MASCOT_BRUTAL : MASCOT_ROAST));
    }
    else if (type === 'sudden') mascotSay(pick(MASCOT_SUDDEN_DEATH));
  }

  function selectGuess(it) {
    dropdown.classList.add('hidden');
    suppressDropdown = true;
    input.value = '';
    if (finished || guessesUsed >= MAX_GUESSES) return;
    if (Object.values(guessed).some(g => norm(g.name) === norm(it.name))) return; // already guessed

    if (it.rank >= 1 && it.rank <= 10) {
      guessed[it.rank] = it;
      // every guess counts, except in sudden death (1 guess left) where
      // correct answers keep you going without consuming it
      if (guessesUsed < MAX_GUESSES - 1) {
        guessesUsed++;
      }
      mascotReact('happy');
    } else {
      guessesUsed++;
      outsideHits.push({ name: it.name, rank: it.rank });
      // so close (11-15) vs way off (16+)
      mascotReact(it.rank <= 15 ? 'close' : 'roast');
    }
    // entering sudden death?
    if (guessesUsed === MAX_GUESSES - 1 && !finished) {
      setTimeout(() => mascotReact('sudden'), 1200);
    }
    saveToURL();
    renderBoard();
    checkFinish();
  }

  // typed entry without dropdown (Enter key)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = input.value.trim();
      if (!val) return;
      const suggestions = getSuggestions(val);
      const exact = findItem(val);
      if (exact) selectGuess(exact);
      else if (suggestions.length === 1) selectGuess(suggestions[0]);
      else if (suggestions.length > 1) renderDropdown(suggestions);
      else {
        // wrong guess
        dropdown.classList.add('hidden');
        suppressDropdown = true;
        input.value = '';
        if (!finished && guessesUsed < MAX_GUESSES) {
          guessesUsed++;
          wrongGuesses.push(val);
          mascotReact('roast');
          // entering sudden death?
          if (guessesUsed === MAX_GUESSES - 1 && !finished) {
            setTimeout(() => mascotReact('sudden'), 1200);
          }
          saveToURL();
          renderBoard();
          checkFinish();
        }
      }
    }
  });

  function checkFinish() {
    const found = Object.keys(guessed).length;
    if (found === 10 || guessesUsed >= MAX_GUESSES) finishGame(false);
  }

  // ---------- Reveal ----------
  $('reveal-btn').onclick = () => $('reveal-confirm').classList.remove('hidden');
  $('reveal-no').onclick = () => $('reveal-confirm').classList.add('hidden');
  $('reveal-yes').onclick = () => {
    $('reveal-confirm').classList.add('hidden');
    finishGame(true);
  };

  // ---------- Finish ----------
  function score() { return Object.keys(guessed).length; }

  function finishGame(wasRevealed) {
    if (finished) return;
    finished = true;
    revealed = wasRevealed;
    if (wasRevealed) {
      for (const it of puzzle.cat.items) {
        if (it.rank >= 1 && it.rank <= 10 && !guessed[it.rank]) guessed[it.rank] = it;
      }
    }
    saveToURL();
    renderBoard();
    $('game-area').classList.add('hidden');
    const fa = $('finish-area');
    fa.classList.remove('hidden');
    $('finish-title').textContent = wasRevealed ? 'Answers revealed' : (score() === 10 ? 'Perfect 10!' : 'Puzzle complete');
    $('finish-score').textContent = `${player}: ${score()}/10`;
    $('finish-grid').textContent = gridText();
    renderRecap(wasRevealed);
    // mascot reacts to final score — brutal for bad scores
    const finalScore = score();
    if (wasRevealed) mascotSay(pick(MASCOT_BRUTAL));
    else if (finalScore <= 3) mascotSay(pick(MASCOT_BRUTAL));
    else if (finalScore <= 6) mascotSay(pick(MASCOT_ROAST));
    else if (finalScore === 10) mascotReact('happy');
    // auto-submit to Supabase
    autoSubmit();
  }

  // Show what you got right and wrong — but never the answers you missed
  function renderRecap(wasRevealed) {
    const el = $('finish-recap');
    el.innerHTML = '';
    // Correct answers you actually guessed (not auto-filled on reveal)
    const actuallyGuessed = wasRevealed
      ? Object.values(guessed).filter(it => {
          // on reveal, we can't distinguish; show all as revealed
          return true;
        })
      : Object.values(guessed);
    const correct = actuallyGuessed.sort((a, b) => a.rank - b.rank);
    if (correct.length) {
      const h = document.createElement('h3');
      h.textContent = wasRevealed ? '✓ Answers (revealed)' : '✓ You got';
      h.className = 'recap-heading recap-correct';
      el.appendChild(h);
      correct.forEach(it => {
        const d = document.createElement('div');
        d.className = 'recap-item recap-correct-item';
        d.textContent = `#${it.rank} — ${it.name}`;
        el.appendChild(d);
      });
    }
    // Wrong guesses (not in the dataset at all)
    if (wrongGuesses.length) {
      const h = document.createElement('h3');
      h.textContent = '✗ Misses';
      h.className = 'recap-heading recap-wrong';
      el.appendChild(h);
      wrongGuesses.forEach(w => {
        const d = document.createElement('div');
        d.className = 'recap-item recap-wrong-item';
        d.textContent = w;
        el.appendChild(d);
      });
    }
    // Outside top-10 hits
    if (outsideHits.length) {
      const h = document.createElement('h3');
      h.textContent = 'Outside the top 10';
      h.className = 'recap-heading recap-outside';
      el.appendChild(h);
      outsideHits.slice().sort((a, b) => a.rank - b.rank).forEach(oh => {
        const d = document.createElement('div');
        d.className = 'recap-item recap-outside-item';
        d.textContent = `#${oh.rank} — ${oh.name}`;
        el.appendChild(d);
      });
    }
    // Answers you missed (only when game ended, not revealed, and we have guess data)
    // If guessed is empty, we don't know what was guessed (cross-device), so skip this section
    const hasGuessData = Object.keys(guessed).length > 0 || wrongGuesses.length > 0 || outsideHits.length > 0;
    if (!wasRevealed && hasGuessData) {
      const missed = [];
      for (let r = 1; r <= 10; r++) {
        if (!guessed[r]) {
          const it = puzzle.cat.items.find(i => i.rank === r);
          if (it) missed.push(it);
        }
      }
      if (missed.length) {
        const h = document.createElement('h3');
        h.textContent = 'You missed';
        h.className = 'recap-heading recap-missed';
        el.appendChild(h);
        missed.forEach(it => {
          const d = document.createElement('div');
          d.className = 'recap-item recap-missed-item';
          d.textContent = `#${it.rank} — ${it.name}`;
          el.appendChild(d);
        });
      }
    }
  }

  function gridText() {
    let s = '';
    for (let r = 1; r <= 10; r++) s += guessed[r] ? '🟩' : '⬜';
    return s;
  }

  function resultBlock() {
    return `Guessten #${puzzle.puzzleNumber} — ${puzzle.cat.title}\n${player}: ${score()}/10${revealed ? ' (revealed)' : ''}\n${gridText()}`;
  }

  $('copy-result-btn').onclick = async () => {
    try { await navigator.clipboard.writeText(resultBlock()); $('copy-result-btn').textContent = 'Copied!'; }
    catch (e) { $('copy-result-btn').textContent = 'Copy failed'; }
    setTimeout(() => { $('copy-result-btn').textContent = 'Copy result'; }, 2000);
  };

  $('copy-progress-btn').onclick = async () => {
    try { await navigator.clipboard.writeText(encodeProgress()); $('copy-progress-btn').textContent = 'Code copied!'; }
    catch (e) { $('copy-progress-btn').textContent = 'Copy failed'; }
    setTimeout(() => { $('copy-progress-btn').textContent = 'Copy progress code'; }, 2000);
  };

  async function autoSubmit() {
    const st = $('submit-status');
    if (!window.DTDB || !window.DTDB.isReady()) {
      st.textContent = 'Score not sent — Supabase not configured.';
      st.className = 'err';
      return;
    }
    st.textContent = 'Sending score…';
    st.className = '';
    const res = await window.DTDB.submitScore({
      player, day: dayISO, puzzleNumber: puzzle.puzzleNumber,
      category: puzzle.cat.title, score: score(),
      guessesUsed, revealed,
      guessedRanks: Object.keys(guessed).map(Number)
    });
    if (res.ok) { st.textContent = 'Score saved ✓'; st.className = 'ok'; submitted = true; }
    else { st.textContent = 'Could not save score: ' + res.error; st.className = 'err'; }
  }

  // ---------- Tabs ----------
  document.querySelectorAll('#tabs button').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('#tabs button').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      $('tab-' + b.dataset.tab).classList.add('active');
      if (b.dataset.tab === 'today') renderToday();
      if (b.dataset.tab === 'season') renderSeason();
      if (b.dataset.tab === 'archive') renderArchive();
    };
  });

  // ---------- Today (live) ----------
  let todayUnsub = null;
  const idToName = { jake: 'Jake', kevin: 'Kevin', alex: 'Alex', joey: 'Joey' };

  async function renderToday() {
    const board = $('today-board');
    if (!window.DTDB || !window.DTDB.isReady()) {
      board.innerHTML = '<p class="muted">Live scores need Supabase configured.</p>';
      return;
    }
    board.innerHTML = '<p class="muted">Waiting for scores…</p>';
    await window.DTDB.subscribeToday(dayISO, (rows) => {
      if (!rows.length) { board.innerHTML = '<p class="muted">No scores yet today.</p>'; return; }
      // best row per player
      const best = {};
      for (const r of rows) {
        const pid = r.player_id;
        if (!best[pid] || r.score > best[pid].score || (r.score === best[pid].score && r.guesses_used < best[pid].guesses_used)) best[pid] = r;
      }
      const verdict = window.DTDB.judgeDay(rows);
      const winners = verdict ? verdict.winners : [];
      const sorted = Object.values(best).sort((a, b) => b.score - a.score || a.guesses_used - b.guesses_used);
      board.innerHTML = '';
      for (const r of sorted) {
        const name = idToName[r.player_id] || r.player_id;
        const div = document.createElement('div');
        div.className = 'score-row' + (winners.includes(r.player_id) ? ' winner' : '');
        const isWinner = winners.includes(r.player_id);
        const isTie = isWinner && winners.length > 1;
        const isLoser = sorted.length > 1 && r === sorted[sorted.length - 1] && !isWinner;
        const hat = isTie ? '<span class="avatar-hat">🤝</span>' : isWinner ? '<span class="avatar-hat">👑</span>' : isLoser ? '<span class="avatar-hat">🤡</span>' : '';
        div.innerHTML = `<span class="who"><span class="avatar-wrap"><img src="avatars/${name.toLowerCase()}.webp" alt="${escapeHtml(name)}" class="avatar-score" />${hat}</span>${escapeHtml(name)}${r.revealed ? ' (revealed)' : ''}</span>
          <span><span class="sc">${r.score}/10</span> <span class="sub">${r.guesses_used} guesses</span></span>`;
        board.appendChild(div);
      }
      const missing = ROSTER.filter(n => !Object.keys(best).some(pid => idToName[pid] === n));
      if (missing.length) {
        const p = document.createElement('p');
        p.className = 'muted';
        p.textContent = 'Still to play: ' + missing.join(', ');
        board.appendChild(p);
      }
    });
  }

  // ---------- Season ----------
  async function renderSeason() {
    const sb = $('season-board'), stb = $('streaks-board');
    if (!window.DTDB || !window.DTDB.isReady()) {
      sb.innerHTML = '<p class="muted">Standings need Supabase configured.</p>';
      stb.innerHTML = '';
      return;
    }
    sb.innerHTML = '<p class="muted">Loading…</p>';
    const scores = await window.DTDB.fetchScores();
    const table = window.DTDB.computeStandings(scores);
    const sorted = ROSTER.slice().sort((a, b) =>
      table[b].wins - table[a].wins || table[b].ties - table[a].ties || table[b].totalScore - table[a].totalScore);
    let html = '<table class="standings"><tr><th>Player</th><th>W</th><th>L</th><th>T</th><th>Pts</th></tr>';
    for (const n of sorted) {
      const t = table[n];
      html += `<tr><td><span class="avatar-wrap"><img src="avatars/${n.toLowerCase()}.webp" alt="${n}" class="avatar-score" /></span><strong>${n}</strong></td><td>${t.wins}</td><td>${t.losses}</td><td>${t.ties}</td><td>${t.totalScore}</td></tr>`;
    }
    sb.innerHTML = html + '</table><p class="muted">A day counts once all four have played.</p>';

    const streaks = window.DTDB.computeStreaks(scores);
    let sh = '<table class="standings"><tr><th>Player</th><th>Streak</th></tr>';
    for (const n of ROSTER) {
      const s = streaks[n];
      const label = !s.type ? '—' : (s.type === 'W' ? `🔥 W${s.count}` : `❄ L${s.count}`);
      sh += `<tr><td><strong>${n}</strong></td><td>${label}</td></tr>`;
    }
    stb.innerHTML = sh + '</table>';
  }

  // ---------- Archive ----------
  function renderArchive() {
    const list = $('archive-list');
    list.innerHTML = '';
    const cats = window.DAILY_TEN_CATEGORIES;
    for (let i = dayIdx - 1; i >= 0 && i >= dayIdx - 27; i--) {
      const { cat, puzzleNumber } = categoryForDay(i);
      const d = new Date(Date.parse(EPOCH_ISO + 'T12:00:00') + i * 86400000);
      const iso = d.toISOString().slice(0, 10);
      const div = document.createElement('div');
      div.className = 'archive-item';
      div.innerHTML = `<div class="d">#${puzzleNumber} · ${iso}</div><div class="t">${escapeHtml(cat.title)}</div>`;
      list.appendChild(div);
    }
    if (!list.children.length) list.innerHTML = '<p class="muted">No past puzzles yet.</p>';
  }

  // ---------- Player badge / switch ----------
  function updateBadge() {
    if (player) {
      $('player-badge').classList.remove('hidden');
      $('player-name').textContent = player;
      const av = $('player-avatar');
      av.src = `avatars/${player.toLowerCase()}.webp`;
      av.alt = player;
    } else $('player-badge').classList.add('hidden');
  }
  $('switch-player').onclick = () => { showPicker(); };
  $('switch-player-big').onclick = () => { showPicker(); };

  // ---------- Picker wiring ----------
  $('confirm-yes').onclick = () => {
    player = pendingName;
    hidePicker();
    $('name-confirm').classList.add('hidden');
    startGame();
  };
  $('confirm-no').onclick = () => { $('name-confirm').classList.add('hidden'); pendingName = null; };
  $('resume-code-btn').onclick = () => $('resume-code-entry').classList.toggle('hidden');
  $('resume-code-go').onclick = () => {
    if (decodeProgress($('resume-code-input').value.trim())) {
      hidePicker();
      startGame();
    } else alert('That code didn\'t work for today\'s puzzle.');
  };

  // ---------- Start ----------
  async function startGame() {
    updateBadge();
    $('puzzle-num').textContent = 'Puzzle #' + puzzle.puzzleNumber;
    $('puzzle-date').textContent = dayISO;
    $('category-title').textContent = puzzle.cat.title;
    const src = $('source-link');
    src.innerHTML = puzzle.cat.source_url
      ? `Data: <a href="${puzzle.cat.source_url}" target="_blank" rel="noopener">${escapeHtml(puzzle.cat.source)}</a>`
      : `Data: ${escapeHtml(puzzle.cat.source)}`;

    // Replay lockout: if this player already submitted today, show their
    // completed run (locked) instead of letting them play again.
    if (window.DTDB && window.DTDB.isReady() && !finished) {
      const pid = window.DTDB.ROSTER_IDS[player];
      const existing = await window.DTDB.fetchPlayerScore(pid, dayISO);
      if (existing) {
        // restore their submitted run from the database
        const byRank = {};
        for (const it of puzzle.cat.items) byRank[it.rank] = it;
        // Only overwrite guessed if the database has rank data;
        // otherwise keep what was restored from localStorage.
        const dbRanks = (existing.guessed_ranks || '').split(',').filter(Boolean);
        if (dbRanks.length) {
          guessed = {};
          dbRanks.forEach(r => {
            const it = byRank[parseInt(r, 10)];
            if (it) guessed[it.rank] = it;
          });
        }
        guessesUsed = existing.guesses_used;
        revealed = existing.revealed;
        finished = true;
        submitted = true;
        showLockedFinish(existing);
        return;
      }
    }

    saveToURL();
    // restore copy button (may have been hidden by a previous lockout)
    $('copy-result-btn').style.display = '';
    if (finished) {
      $('game-area').classList.add('hidden');
      const fa = $('finish-area');
      fa.classList.remove('hidden');
      $('finish-title').textContent = revealed ? 'Answers revealed' : 'Puzzle complete';
      $('finish-score').textContent = `${player}: ${score()}/10`;
      $('finish-grid').textContent = gridText();
      if (!submitted) autoSubmit();
    } else {
      $('finish-area').classList.add('hidden');
      $('game-area').classList.remove('hidden');
      renderBoard();
    }
  }

  // Show a locked finish screen for a player who already submitted.
  function showLockedFinish(row) {
    $('game-area').classList.add('hidden');
    const fa = $('finish-area');
    fa.classList.remove('hidden');
    $('finish-title').textContent = 'Already submitted';
    $('finish-score').textContent = `${player}: ${row.score}/10${row.revealed ? ' (revealed)' : ''}`;
    // Only show the grid if we have guess data; otherwise it's misleading
    const hasGuessData = Object.keys(guessed).length > 0;
    if (hasGuessData) {
      let grid = '';
      for (let r = 1; r <= 10; r++) grid += guessed[r] ? '🟩' : '⬜';
      $('finish-grid').textContent = grid;
    } else {
      $('finish-grid').textContent = '';
    }
    const st = $('submit-status');
    st.textContent = hasGuessData
      ? 'Your score is locked in for today. See you tomorrow.'
      : 'Your score is locked in for today. Play on the same device to see your full recap. See you tomorrow.';
    st.className = 'ok';
    // show the full recap: category, correct answers, misses
    renderRecap(row.revealed);
    // hide the copy-result button to keep it clean (score already submitted)
    $('copy-result-btn').style.display = 'none';
  }

  // ---------- Boot ----------
  function boot() {
    // Supabase (optional until keys are filled in)
    if (window.DTDB) {
      if (window.DTDB.init()) console.log('Supabase connected');
      else console.log('Supabase not configured — playing offline');
    }
    // Restore or pick name: try URL first, then localStorage backup
    if (!loadFromURL() && !loadFromStorage()) showPicker();
    else { hidePicker(); startGame(); }
    renderArchive();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
