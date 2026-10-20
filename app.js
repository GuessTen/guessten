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
    // live projection — "on pace for X/10" from the current hit rate
    const projEl = $('pace-projection');
    const found = Object.keys(guessed).length;
    if (!finished && guessesUsed > 0 && found < 10) {
      const slotsLeft = 10 - found;
      const rate = found / guessesUsed;
      const proj = Math.min(10, found + Math.min(slotsLeft, Math.round(rate * left)));
      projEl.textContent = `On pace for ${proj}/10`;
      projEl.classList.remove('hidden');
    } else {
      projEl.classList.add('hidden');
    }
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
    "Did you even try, {name}, you dumbass?",
    "My grandmother got that one and she's dead.",
    "Yikes, {name}. Just... fucking yikes.",
    "The top hat is disappointed in you.",
    "That was... a choice. A shit one.",
    "Bold strategy, {name}. Fucking terrible, but bold.",
    "What the fuck was that?",
    "Are you fucking kidding me right now, {name}?",
    "Jesus Christ, that was awful.",
    "I'd roast you but the answers already did, {name}.",
    "Do you even know what a top 10 is, moron?",
    "That guess was absolute dogshit, {name}.",
    "The cane just filed for divorce.",
    "Holy shit, that was bad.",
    "I've seen better guesses from a drunk toddler.",
    "You play like you're trying to lose, {name}.",
    "That was so bad I felt it in my mustache.",
    "Were you dropped on your head as a child, {name}?",
    "Congratulations {name}, that's the dumbest shit I've heard today.",
    "You couldn't guess your way out of a paper bag."
  ];
  const MASCOT_BRUTAL = [
    "{name}, you're fucking embarrassing yourself.",
    "I've seen smarter moves from a concussed pigeon.",
    "This is painful to watch, {name}. Genuinely fucking painful.",
    "Are you doing this on purpose, {name}? You have to be.",
    "Fucking hell, {name}. Just... fucking hell.",
    "Your brain called, {name}, it wants a refund.",
    "I'd tell you to try harder but I'm not sure you can.",
    "This is the worst shit I've ever seen.",
    "You absolute fucking donkey, {name}.",
    "Did your parents have any children that lived?",
    "I'm dumber just from watching you play, {name}.",
    "You guess like someone who's never had a thought.",
    "Fuck me, {name}, that was atrocious.",
    "I'd rather watch paint dry than watch you play again.",
    "You're the reason the top hat drinks.",
    "Holy fucking shit {name}, are you even trying? My dead goldfish plays better than this.",
    "You couldn't find your ass with both hands and a fucking map, {name}.",
    "What the actual fuck is wrong with you, {name}? That was braindead.",
    "I've watched rocks make better decisions than you just did.",
    "You're playing like you got hit in the head with a fucking brick, {name}. Repeatedly.",
    "Jesus fucking Christ on a cracker, {name}, that was godawful.",
    "Do you have shit for brains, {name}? Because that's what that guess tasted like.",
    "I'd call you a dumbass, {name}, but that would be an insult to dumbasses everywhere.",
    "Fuck off with that guess, {name}. Seriously, fuck right off.",
    "You're so fucking bad at this, {name}, I'm starting to feel sorry for your mother.",
    "That guess was so shit I need to bleach my fucking eyeballs.",
    "Are you fucking illiterate, {name}? Can you even read the goddamn question?",
    "You play this game like a blindfolded monkey throwing darts at a wall of shit.",
    "Goddamn, {name}, you suck. Like, historically, impressively, mind-blowingly suck.",
    "I've got hemorrhoids smarter than you, {name}, you absolute fucking waste of oxygen."
  ];
  // Escalating roasts: the more consecutive fuck-ups, the meaner he gets
  const MASCOT_NUCLEAR = [
    "STOP, {name}. Just fucking stop. You're done. Put the phone down, you braindead fuck.",
    "I have watched you fail so many times, {name}, I've lost the will to fucking live.",
    "You are the single dumbest motherfucker I have ever had the displeasure of hosting, {name}.",
    "If stupidity was a crime, {name}, you'd be on fucking death row right now.",
    "I would rather gargle broken glass than watch you butcher another goddamn guess, {name}.",
    "You're not just bad, {name}, you're a catastrophic fucking failure of a human being.",
    "Every guess you make kills a brain cell. Mine. I'm getting dumber watching this shit, {name}.",
    "Fuck this. Fuck you, {name}. Fuck everything. You're hopeless, you absolute shitstain.",
    "I've seen roadkill with better instincts than you, {name}, you fucking Neanderthal.",
    "Congratulations {name}, you've achieved a level of suck so profound it's almost art. Almost.",
    "{name}, I've met fucking houseplants with more game sense than you.",
    "Your family tree must be a goddamn wreath, {name}. Inbreeding explains a lot.",
    "I'd say you're playing like shit, {name}, but shit at least serves a purpose.",
    "{name}, you dumb cunt, a lobotomized squirrel could outplay you right now.",
    "Sweet Jesus, {name}, I've seen abortions with more potential than your gameplay.",
    "You're so fucking useless, {name}, your own shadow is embarrassed to follow you.",
    "{name}, if I had a dick I'd slap you with it for that galaxy-brain fucking guess.",
    "Fucking pathetic, {name}. Your ancestors are spinning in their graves watching this.",
    "{name}, you're the human equivalent of a participation trophy. Fucking worthless.",
    "I hope you step on a Lego, {name}. Then another one. Then choke on a third one, you dense fuck."
  ];
  // Beyond nuclear: for when someone is having a historically atrocious game
  const MASCOT_APOCALYPTIC = [
    "{name}. {name}. {name}. I want you to know that everyone who loves you is disappointed.",
    "I've hosted thousands of games, {name}, and you are rock bottom. The absolute fucking floor.",
    "{name}, at this point I'm not even roasting you. I'm performing a mercy killing on your dignity.",
    "You know what, {name}? Fuck it. I've given up. You're unfixable. A lost cause. A waste of my goddamn time.",
    "{name}, I just felt the collective IQ of the planet drop. That was you. That was all you.",
    "If there were a Hall of Fame for being dogshit at trivia, {name}, they'd build a whole wing for you.",
    "{name}, Satan just called. Even HE thinks you're too much of a fucking disappointment.",
    "I'm going to be honest, {name}: I've started rooting for your failure. It's the only entertainment here.",
    "{name}, you make me wish I'd stayed a drawing on a napkin. Anything to avoid witnessing this.",
    "Final verdict, {name}: you're a fucking disaster, your guesses are war crimes, and I hate this."
  ];
  const MASCOT_SUDDEN_DEATH = [
    "Sudden death! No pressure...",
    "One guess left. The mustache is sweating.",
    "This is where legends are made. Or broken."
  ];

  let speechTimer = null;
  function mascotSay(text) {
    const el = $('mascot-speech');
    // Personalize: replace {name} with the player's name
    if (player) text = text.replace(/\{name\}/g, player);
    el.textContent = text;
    el.classList.remove('hidden');
    positionSpeech();
    // talking animation while he speaks
    mascotExpress('talking');
    // re-trigger animation
    el.style.animation = 'none';
    el.offsetHeight;
    el.style.animation = '';
    if (speechTimer) clearTimeout(speechTimer);
    speechTimer = setTimeout(() => el.classList.add('hidden'), 4000);
  }

  // Play a mascot expression animation, then return to idle
  function mascotExpress(expr) {
    const m = document.getElementById('mascot');
    if (!m) return;
    m.classList.remove('laughing', 'talking', 'disappointed', 'celebrating');
    // force reflow so re-adding the class restarts the animation
    void m.offsetWidth;
    m.classList.add(expr);
    // clear after animation completes (max ~2s) so idle resumes
    const durations = { laughing: 1800, talking: 1800, disappointed: 1200, celebrating: 2000 };
    setTimeout(() => m.classList.remove(expr), durations[expr] || 1500);
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
  document.getElementById('mascot').addEventListener('click', () => {
    const greetings = ["Hey!", "What's up?", "I'm watching...", "Make me proud.", "The mustache sees all."];
    mascotSay(greetings[Math.floor(Math.random() * greetings.length)]);
  });
  function buzz(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
  }
  // Track consecutive fuck-ups for escalation
  let consecutiveMisses = 0;
  function mascotReact(type) {
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    if (type === 'happy') {
      buzz(30); consecutiveMisses = 0;
      mascotExpress('celebrating');
      mascotSay(pick(MASCOT_HAPPY));
    }
    else if (type === 'close') { buzz([30, 50, 30]); mascotSay(pick(MASCOT_CLOSE)); }
    else if (type === 'roast') {
      buzz([80, 40, 80]);
      consecutiveMisses++;
      mascotExpress('laughing'); // he laughs at your failure
      // Escalate: 8+ consecutive = apocalyptic, 5+ = nuclear, 3+ wrong & low score = brutal
      if (consecutiveMisses >= 8) {
        buzz([150, 50, 150, 50, 200]);
        mascotSay(pick(MASCOT_APOCALYPTIC));
      } else if (consecutiveMisses >= 5) {
        buzz([100, 50, 100, 50, 150]);
        mascotSay(pick(MASCOT_NUCLEAR));
      } else {
        const bad = wrongGuesses.length >= 3 && score() <= 2;
        if (bad) mascotExpress('disappointed');
        mascotSay(pick(bad ? MASCOT_BRUTAL : MASCOT_ROAST));
      }
    }
    else if (type === 'sudden') { buzz([50, 30, 50, 30, 100]); mascotSay(pick(MASCOT_SUDDEN_DEATH)); }
  }

  // ---------- Idle chatter ----------
  // If the player hasn't guessed in 90 seconds, the mascot gets impatient
  let idleTimer = null;
  const IDLE_LINES = [
    "Hello? {name}? You alive in there?",
    "Take your time, {name}. It's not like the puzzle solves itself. Oh wait.",
    "You thinking or just staring at the screen like an idiot, {name}?",
    "Any day now, {name}. ANY. DAY. NOW.",
    "I've aged three years waiting for your next guess, {name}.",
    "{name}, the top hat is falling asleep. Guess something, you coward.",
  ];
  function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    if (finished) return;
    idleTimer = setTimeout(() => {
      if (!finished && player) {
        mascotSay(IDLE_LINES[Math.floor(Math.random() * IDLE_LINES.length)]);
        resetIdleTimer(); // keep nagging every 90s
      }
    }, 90000);
  }

  function selectGuess(it) {
    dropdown.classList.add('hidden');
    suppressDropdown = true;
    input.value = '';
    if (finished || guessesUsed >= MAX_GUESSES) return;
    if (Object.values(guessed).some(g => norm(g.name) === norm(it.name))) return; // already guessed
    resetIdleTimer(); // they guessed, reset the nag timer

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

  // ---------- Confetti ----------
  function fireConfetti() {
    const c = document.createElement('canvas');
    c.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none;';
    document.body.appendChild(c);
    const ctx = c.getContext('2d');
    c.width = window.innerWidth; c.height = window.innerHeight;
    const colors = ['#1e3a5f', '#f4d35e', '#ee964b', '#f95738', '#0d8a72', '#ffffff'];
    const parts = [];
    for (let i = 0; i < 150; i++) {
      parts.push({
        x: Math.random() * c.width, y: -20 - Math.random() * c.height * 0.3,
        w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
        color: colors[Math.floor(Math.random() * colors.length)],
        vy: 2 + Math.random() * 3, vx: -1.5 + Math.random() * 3,
        rot: Math.random() * Math.PI * 2, vr: -0.1 + Math.random() * 0.2
      });
    }
    let frames = 0;
    function tick() {
      ctx.clearRect(0, 0, c.width, c.height);
      parts.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vy += 0.05;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color; ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
        ctx.restore();
      });
      if (++frames < 240) requestAnimationFrame(tick);
      else c.remove();
    }
    tick();
    buzz([50, 50, 50, 50, 100]);
  }

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
    // mascot reacts to final score — nuclear for truly awful scores
    const finalScore = score();
    if (wasRevealed) mascotSay(pick(MASCOT_BRUTAL));
    else if (finalScore === 0) mascotSay(pick(MASCOT_APOCALYPTIC));
    else if (finalScore <= 2) mascotSay(pick(MASCOT_NUCLEAR));
    else if (finalScore <= 4) mascotSay(pick(MASCOT_BRUTAL));
    else if (finalScore <= 6) mascotSay(pick(MASCOT_ROAST));
    else if (finalScore === 10) { mascotReact('happy'); setTimeout(fireConfetti, 500); }
    // personal best alert — beat your all-time high (today's game excluded)
    const pbEl = $('pb-alert');
    pbEl.classList.add('hidden');
    if (!wasRevealed && finalScore > 0 && window.DTDB && window.DTDB.isReady()) {
      window.DTDB.fetchPlayerBest(player, dayISO).then(best => {
        if (best !== null && finalScore > best) {
          pbEl.innerHTML = `🔥 <strong>New personal best!</strong> Your previous best was ${best}/10.`;
          pbEl.classList.remove('hidden');
          mascotReact('happy');
        }
      }).catch(() => {});
    }
    // Manual submit: reset the submit UI. The button's click handler is wired
    // once at boot via delegation (see below) so it can never be left dead by
    // an error elsewhere in the finish flow.
    resetSubmitUI();
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

  // 50-square grid for copy/paste: all 50 ranked items, 10 per line.
  // 🟩 = top-10 correct, 🟨 = guessed but outside top 10, ⬜ = missed/unguessed.
  function gridText50() {
    const hitRanks = new Set(outsideHits.map(h => h.rank));
    let s = '';
    for (let r = 1; r <= 50; r++) {
      if (r <= 10) s += guessed[r] ? '🟩' : '⬜';
      else s += hitRanks.has(r) ? '🟨' : '⬜';
      if (r % 10 === 0 && r < 50) s += '\n';
    }
    return s;
  }

  function resultBlock() {
    return `Guessten #${puzzle.puzzleNumber} — ${puzzle.cat.title}\n${player}: ${score()}/10${revealed ? ' (revealed)' : ''}\n${gridText50()}\nhttps://guessten.github.io/guessten/`;
  }

  $('copy-result-btn').onclick = async () => {
    try { await navigator.clipboard.writeText(resultBlock()); $('copy-result-btn').textContent = 'Copied!'; }
    catch (e) { $('copy-result-btn').textContent = 'Copy failed'; }
    setTimeout(() => { $('copy-result-btn').textContent = 'Copy result'; }, 2000);
  };

  $('share-image-btn').onclick = async () => {
    const btn = $('share-image-btn');
    try {
      // Draw result card on canvas
      const c = document.createElement('canvas');
      c.width = 600; c.height = 420;
      const x = c.getContext('2d');
      // background
      x.fillStyle = '#fdf6e3'; x.fillRect(0, 0, 600, 420);
      x.fillStyle = '#1e3a5f'; x.fillRect(0, 0, 600, 90);
      // title
      x.fillStyle = '#fff'; x.font = 'bold 36px system-ui'; x.textAlign = 'center';
      x.fillText('Guessten', 300, 55);
      // puzzle info
      x.fillStyle = '#1e3a5f'; x.font = '600 24px system-ui';
      x.fillText(`#${puzzle.puzzleNumber} — ${puzzle.cat.title}`, 300, 140);
      x.font = 'bold 32px system-ui';
      x.fillText(`${player}: ${score()}/10${revealed ? ' (revealed)' : ''}`, 300, 190);
      // grid squares
      const sq = 44, gap = 8, startX = 300 - (5 * (sq + gap) - gap) / 2;
      for (let r = 1; r <= 10; r++) {
        const row = Math.floor((r - 1) / 5), col = (r - 1) % 5;
        x.fillStyle = guessed[r] ? '#22c55e' : '#e5e0d0';
        x.fillRect(startX + col * (sq + gap), 220 + row * (sq + gap), sq, sq);
      }
      // footer
      x.fillStyle = '#8a6d3b'; x.font = '20px system-ui';
      x.fillText('guessten.github.io/guessten', 300, 380);

      const blob = await new Promise(res => c.toBlob(res, 'image/png'));
      const file = new File([blob], 'guessten-result.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'My Guessten result' });
      } else {
        // fallback: download
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'guessten-result.png';
        a.click(); URL.revokeObjectURL(a.href);
        btn.textContent = 'Downloaded!';
      }
    } catch (e) {
      if (e.name !== 'AbortError') btn.textContent = 'Share failed';
    }
    setTimeout(() => { btn.textContent = 'Share image'; }, 2000);
  };

  $('copy-progress-btn').onclick = async () => {
    try { await navigator.clipboard.writeText(encodeProgress()); $('copy-progress-btn').textContent = 'Code copied!'; }
    catch (e) { $('copy-progress-btn').textContent = 'Copy failed'; }
    setTimeout(() => { $('copy-progress-btn').textContent = 'Copy progress code'; }, 2000);
  };

  // ---------- Offline score queue ----------
  const QUEUE_KEY = 'guessten-pending-scores';
  function getQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveQueue(q) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (e) {}
  }
  // Robust submit: 3 attempts with backoff, 12s timeout each, verifies the
  // row actually landed in the database before reporting success.
  async function robustSubmit(payload, attempts = 3) {
    for (let i = 1; i <= attempts; i++) {
      try {
        const res = await Promise.race([
          window.DTDB.submitScore(payload),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 12000))
        ]);
        if (!res.ok) throw new Error(res.error || 'submit failed');
        // Verify the write actually landed
        const pid = window.DTDB.ROSTER_IDS[payload.player];
        const check = await Promise.race([
          window.DTDB.fetchPlayerScore(pid, payload.day),
          new Promise((_, reject) => setTimeout(() => reject(new Error('verify timeout')), 8000))
        ]);
        if (check && check.score === payload.score) return { ok: true };
        throw new Error('write not confirmed');
      } catch (e) {
        // Log each failed attempt for diagnostics (silent, behind the scenes)
        if (window.DTDB && window.DTDB.logSubmitError) {
          window.DTDB.logSubmitError({
            player: payload.player, day: payload.day,
            puzzleNumber: payload.puzzleNumber, score: payload.score,
            error: e.message, attempt: i
          });
        }
        if (i === attempts) return { ok: false, error: e.message };
        await new Promise(r => setTimeout(r, 1500 * i)); // 1.5s, 3s backoff
      }
    }
    return { ok: false, error: 'exhausted retries' };
  }

  async function flushQueue() {
    if (!window.DTDB || !window.DTDB.isReady()) return;
    const q = getQueue();
    if (!q.length) return;
    const remaining = [];
    for (const payload of q) {
      try {
        const res = await robustSubmit(payload, 2);
        if (!res.ok) remaining.push(payload);
      } catch (e) { remaining.push(payload); }
    }
    saveQueue(remaining);
    if (q.length !== remaining.length) {
      const st = $('submit-status');
      if (st) { st.textContent = 'Score saved ✓'; st.className = 'ok'; }
    }
  }
  window.addEventListener('online', flushQueue);
  // Periodic flush: while the app is open, retry any queued scores every 30s
  setInterval(() => { if (getQueue().length) flushQueue(); }, 30000);

  // ---------- Manual submit UI ----------
  function setShareLocked(locked) {
    ['copy-result-btn', 'share-image-btn'].forEach(id => {
      const b = $(id);
      if (!b) return;
      b.disabled = locked;
      b.style.opacity = locked ? '0.4' : '1';
    });
  }

  function resetSubmitUI() {
    const submitBtn = $('submit-score-btn');
    if (submitBtn) {
      submitBtn.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit score to leaderboard';
    }
    const st = $('submit-status');
    if (st) { st.textContent = ''; st.className = 'hidden'; }
    setShareLocked(true);
  }

  async function handleSubmitTap() {
    const submitBtn = $('submit-score-btn');
    if (!submitBtn || submitBtn.disabled || submitted) return;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';
    await autoSubmit();
    const st = $('submit-status');
    if (submitted && st && /saved ✓/i.test(st.textContent)) {
      submitBtn.classList.add('hidden');
      setShareLocked(false);
    } else {
      submitBtn.disabled = false;
      submitBtn.textContent = '⚠️ Submit score to leaderboard — tap to retry';
    }
  }

  // Delegated listener: wired once, survives any finish-flow errors.
  document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'submit-score-btn') handleSubmitTap();
  });

  async function autoSubmit() {
    const st = $('submit-status');
    if (st) { st.classList.remove('hidden'); }
    if (!window.DTDB || !window.DTDB.isReady()) {
      if (st) {
        st.textContent = '⚠️ Score NOT sent — no connection to the league server.';
        st.className = 'warn';
      }
      return;
    }
    if (st) { st.textContent = 'Sending score…'; st.className = ''; }
    const payload = {
      player, day: dayISO, puzzleNumber: puzzle.puzzleNumber,
      category: puzzle.cat.title, score: score(),
      guessesUsed, revealed,
      guessedRanks: Object.keys(guessed).map(Number)
    };
    try {
      const res = await robustSubmit(payload);
      if (res.ok) {
        if (st) { st.textContent = 'Score saved ✓'; st.className = 'ok'; }
        submitted = true;
      }
      else throw new Error(res.error);
    } catch (e) {
      // Failed — log it for diagnostics (behind the scenes, players do nothing),
      // queue it for later, leave the submit button visible for retry
      if (window.DTDB && window.DTDB.logSubmitError) {
        window.DTDB.logSubmitError({
          player, day: dayISO, puzzleNumber: puzzle.puzzleNumber,
          score: score(), error: e.message, attempt: 3
        });
      }
      const q = getQueue();
      if (!q.some(p => p.player === payload.player && p.day === payload.day)) q.push(payload);
      saveQueue(q);
      if (st) {
        st.textContent = '⚠️ Score NOT sent — tap "Submit score" above to retry.';
        st.className = 'warn';
      }
      // don't mark submitted — the manual button stays active for retry
    }
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
      if (b.dataset.tab === 'stats') renderStats();
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
      // Trash-talk: if there's a clear single winner and it's not you, the mascot lets you hear it
      if (verdict && verdict.winners.length === 1 && !missing.length) {
        const winnerId = verdict.winners[0];
        const winnerName = idToName[winnerId] || winnerId;
        if (player && winnerName !== player && !window._leaderRoastedToday) {
          window._leaderRoastedToday = dayISO;
          const taunts = [
            `{name}, ${winnerName} is kicking your ass today. Embarrassing.`,
            `Look at ${winnerName} up there, {name}. You gonna let that slide?`,
            `${winnerName} is running away with it and you're just watching, {name}? Pathetic.`,
            `{name}, ${winnerName} called. They said you're trash.`,
          ];
          setTimeout(() => {
            mascotExpress('laughing');
            mascotSay(taunts[Math.floor(Math.random() * taunts.length)]);
          }, 1500);
        }
      }
    });
  }

  // ---------- Season ----------
  // ---------- Season data cache (60s) ----------
  let seasonCache = { scores: null, at: 0 };
  const SEASON_CACHE_TTL = 60000;
  async function getCachedScores() {
    const now = Date.now();
    if (seasonCache.scores && now - seasonCache.at < SEASON_CACHE_TTL) {
      return seasonCache.scores;
    }
    const scores = await window.DTDB.fetchScores();
    seasonCache = { scores, at: now };
    // also stash for offline fallback
    try { localStorage.setItem('guessten-cached-scores', JSON.stringify({ scores, at: now })); } catch (e) {}
    return scores;
  }
  function getOfflineScores() {
    try {
      const c = JSON.parse(localStorage.getItem('guessten-cached-scores') || 'null');
      return c ? c.scores : null;
    } catch (e) { return null; }
  }

  async function renderSeason() {
    const sb = $('season-board'), stb = $('streaks-board');
    if (!window.DTDB || !window.DTDB.isReady()) {
      sb.innerHTML = '<p class="muted">Standings need Supabase configured.</p>';
      stb.innerHTML = '';
      return;
    }
    sb.innerHTML = '<p class="muted">Loading…</p>';
    let scores, offline = false;
    try {
      scores = await getCachedScores();
    } catch (e) {
      scores = getOfflineScores();
      offline = true;
    }
    if (!scores) {
      sb.innerHTML = '<p class="muted">Could not load standings. Check your connection.</p>';
      stb.innerHTML = '';
      return;
    }
    if (offline) sb.innerHTML = '<p class="muted">Offline — showing cached standings.</p>';
    const table = window.DTDB.computeStandings(scores);
    const sorted = ROSTER.slice().sort((a, b) =>
      table[b].wins - table[a].wins || table[b].ties - table[a].ties || table[b].totalScore - table[a].totalScore);
    let html = '<table class="standings"><tr><th>Player</th><th>W</th><th>L</th><th>T</th></tr>';
    for (const n of sorted) {
      const t = table[n];
      html += `<tr><td><span class="avatar-wrap"><img src="avatars/${n.toLowerCase()}.webp" alt="${n}" class="avatar-score" /></span><strong>${n}</strong></td><td>${t.wins}</td><td>${t.losses}</td><td>${t.ties}</td></tr>`;
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

    // Head-to-head records
    const h2h = window.DTDB.computeHeadToHead(scores);
    let hh = '<h3>Head-to-Head</h3><table class="standings h2h"><tr><th></th>';
    for (const n of ROSTER) hh += `<th>${n}</th>`;
    hh += '</tr>';
    for (const a of ROSTER) {
      hh += `<tr><td><strong>${a}</strong></td>`;
      for (const b of ROSTER) {
        if (a === b) hh += '<td class="muted">—</td>';
        else {
          const r = h2h[a][b];
          hh += `<td>${r.w}-${r.l}${r.t ? '-' + r.t : ''}</td>`;
        }
      }
      hh += '</tr>';
    }
    stb.innerHTML += hh + '</table><p class="muted">Days each player beat the other head-to-head.</p>';

    // Rivalry ticker — spicy callouts based on the data
    const ticker = $('rivalry-ticker');
    const callouts = [];
    // Win streaks (3+)
    for (const n of ROSTER) {
      const s = streaks[n];
      if (s.type === 'W' && s.count >= 3) {
        callouts.push({ emoji: '🔥', text: `${n} has won ${s.count} straight — can anyone stop them?` });
      } else if (s.type === 'L' && s.count >= 3) {
        callouts.push({ emoji: '🧊', text: `${n} has lost ${s.count} in a row… rough.` });
      }
    }
    // Close head-to-head rivalries (within 1 game, min 3 games played)
    for (let i = 0; i < ROSTER.length; i++) {
      for (let j = i + 1; j < ROSTER.length; j++) {
        const a = ROSTER[i], b = ROSTER[j];
        const r = h2h[a][b];
        const total = r.w + r.l + r.t;
        if (total >= 3 && Math.abs(r.w - r.l) <= 1) {
          callouts.push({ emoji: '⚔️', text: `${a} vs ${b} is dead even at ${r.w}-${r.l}${r.t ? '-' + r.t : ''}` });
        } else if (total >= 3 && (r.w === 0 || r.l === 0) && Math.max(r.w, r.l) >= 3) {
          const dom = r.w > r.l ? a : b, sub = r.w > r.l ? b : a;
          callouts.push({ emoji: '💀', text: `${dom} owns ${sub} (${Math.max(r.w, r.l)}-${Math.min(r.w, r.l)})` });
        }
      }
    }
    // Win race leader
    if (sorted.length >= 2) {
      const lead = table[sorted[0]], second = table[sorted[1]];
      const gap = lead.wins - second.wins;
      if (gap >= 2) {
        callouts.push({ emoji: '👑', text: `${sorted[0]} leads by ${gap} wins — ${10 - lead.wins} to go` });
      } else if (gap === 0 && lead.wins > 0) {
        callouts.push({ emoji: '🤝', text: `${sorted[0]} and ${sorted[1]} are tied at ${lead.wins} wins!` });
      }
    }
    if (callouts.length) {
      // rotate through callouts every 5 seconds
      let ti = 0;
      const showTicker = () => {
        const c = callouts[ti % callouts.length];
        ticker.innerHTML = `<span class="ticker-emoji">${c.emoji}</span>${c.text}`;
        ticker.classList.remove('hidden');
        ti++;
      };
      showTicker();
      if (window._tickerInterval) clearInterval(window._tickerInterval);
      if (callouts.length > 1) window._tickerInterval = setInterval(showTicker, 5000);
    } else {
      ticker.classList.add('hidden');
    }

    // Past seasons
    const histEl = $('seasons-history');
    try {
      const seasons = await window.DTDB.fetchSeasons();
      if (!seasons.length) {
        histEl.innerHTML = '<p class="muted">Season 1 in progress — past champions will appear here.</p>';
      } else {
        let sh2 = '<table class="standings"><tr><th>Season</th><th>Champion</th><th>W-L-T</th><th>Runner-up</th></tr>';
        for (const s of seasons) {
          const champ = window.DTDB && s.champion ? s.champion : s.champion;
          sh2 += `<tr><td>#${s.season_number}</td><td>👑 <strong>${s.champion}</strong></td><td>${s.champion_wins}-${s.champion_losses}-${s.champion_ties}</td><td>${s.runner_up || '—'}</td></tr>`;
        }
        histEl.innerHTML = sh2 + '</table>';
      }
    } catch (e) {
      histEl.innerHTML = '<p class="muted">Season 1 in progress.</p>';
    }
  }

  // ---------- Deep Dive Stats ----------
  let statsPlayer = null; // defaults to current player
  function renderStatsPicker() {
    const el = $('stats-player-pick');
    el.innerHTML = '';
    ROSTER.forEach(n => {
      const b = document.createElement('button');
      b.className = 'stats-pick' + ((statsPlayer || player) === n ? ' active' : '');
      b.innerHTML = `<img src="avatars/${n.toLowerCase()}.webp" alt="${n}" class="avatar-inline" /> ${n}`;
      b.onclick = () => { statsPlayer = n; renderStats(); };
      el.appendChild(b);
    });
  }

  async function renderStats() {
    renderStatsPicker();
    const board = $('stats-board');
    const target = statsPlayer || player || 'Jake';
    if (!window.DTDB || !window.DTDB.isReady()) {
      board.innerHTML = '<p class="muted">Stats need Supabase configured.</p>';
      return;
    }
    board.innerHTML = '<p class="muted">Crunching numbers…</p>';
    const targetId = target.toLowerCase();
    let scores;
    try { scores = await getCachedScores(); }
    catch (e) { scores = getOfflineScores(); }
    if (!scores) {
      board.innerHTML = '<p class="muted">Could not load stats. Check your connection.</p>';
      return;
    }
    const mine = scores.filter(s => s.player_id === targetId).sort((a, b) => a.day < b.day ? -1 : 1);
    if (!mine.length) {
      board.innerHTML = `<p class="muted">No games yet for ${target}.</p>`;
      return;
    }

    const table = window.DTDB.computeStandings(scores);
    const streaks = window.DTDB.computeStreaks(scores);
    const t = table[target], st = streaks[target];

    // Basic aggregates
    const totalScore = mine.reduce((s, r) => s + r.score, 0);
    const avg = (totalScore / mine.length).toFixed(1);
    const best = Math.max(...mine.map(r => r.score));
    const worst = Math.min(...mine.map(r => r.score));
    const perfects = mine.filter(r => r.score === 10).length;
    const avgGuesses = (mine.reduce((s, r) => s + r.guesses_used, 0) / mine.length).toFixed(1);
    const winRate = mine.length ? Math.round(t.wins / mine.length * 100) : 0;

    // Score trend: last 12 games
    const recent = mine.slice(-12);
    const maxS = 10;
    let trend = '<div class="trend">';
    for (const r of recent) {
      const h = Math.max(6, r.score / maxS * 80);
      const cls = r.score >= 8 ? 'hot' : r.score >= 5 ? 'mid' : 'cold';
      trend += `<div class="trend-bar ${cls}" style="height:${h}px" title="${r.day}: ${r.score}/10"></div>`;
    }
    trend += '</div>';

    // Best/worst categories (min 1 game each)
    const byCat = {};
    for (const r of mine) {
      const c = r.category || 'Unknown';
      (byCat[c] = byCat[c] || { total: 0, n: 0 }).total += r.score;
      byCat[c].n++;
    }
    const catAvg = Object.entries(byCat).map(([c, v]) => ({ c, avg: v.total / v.n, n: v.n }))
      .sort((a, b) => b.avg - a.avg);
    const bestCats = catAvg.slice(0, 3);
    const worstCats = catAvg.slice(-3).reverse();

    // Day of week performance
    const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const byDow = {};
    for (const r of mine) {
      const d = new Date(r.day + 'T12:00:00');
      const dow = dowNames[d.getDay()];
      (byDow[dow] = byDow[dow] || { total: 0, n: 0, wins: 0 }).total += r.score;
      byDow[dow].n++;
    }
    // mark wins per day
    const byDay = window.DTDB.groupByDay(scores);
    for (const day of Object.keys(byDay)) {
      const verdict = window.DTDB.judgeDay(byDay[day]);
      if (!verdict) continue;
      const d = new Date(day + 'T12:00:00');
      const dow = dowNames[d.getDay()];
      if (byDow[dow] && verdict.winners.includes(targetId)) byDow[dow].wins++;
    }
    let dowHtml = '<div class="dow-grid">';
    for (const d of dowNames) {
      const v = byDow[d];
      const a = v ? (v.total / v.n).toFixed(1) : '—';
      const w = v ? ` (${v.wins}W)` : '';
      dowHtml += `<div class="dow-cell"><span class="dow-name">${d}</span><span class="dow-avg">${a}${w}</span></div>`;
    }
    dowHtml += '</div>';

    // Clutch: wins by margin
    let blowouts = 0, nailbiters = 0;
    for (const day of Object.keys(byDay)) {
      const verdict = window.DTDB.judgeDay(byDay[day]);
      if (!verdict || !verdict.winners.includes(targetId) || verdict.winners.length > 1) continue;
      // find runner-up score
      const rows = byDay[day].filter(r => r.player_id !== targetId && !r.revealed);
      if (!rows.length) continue;
      const myScore = byDay[day].find(r => r.player_id === targetId).score;
      const runnerUp = Math.max(...rows.map(r => r.score));
      const margin = myScore - runnerUp;
      if (margin >= 3) blowouts++;
      else if (margin <= 1) nailbiters++;
    }

    const streakLabel = !st.type ? '—' : (st.type === 'W' ? `🔥 ${st.count} wins` : `❄️ ${st.count} losses`);

    board.innerHTML = `
      <div class="stats-hero">
        <img src="avatars/${target.toLowerCase()}.webp" alt="${target}" class="stats-avatar" />
        <div>
          <h3>${target}</h3>
          <p class="muted">${mine.length} games · ${t.wins}W-${t.losses}L-${t.ties}T</p>
        </div>
      </div>
      <div class="stat-cards">
        <div class="stat-card"><span class="stat-num">${avg}</span><span class="stat-label">Avg score</span></div>
        <div class="stat-card"><span class="stat-num">${winRate}%</span><span class="stat-label">Win rate</span></div>
        <div class="stat-card"><span class="stat-num">${best}</span><span class="stat-label">Best</span></div>
        <div class="stat-card"><span class="stat-num">${perfects}</span><span class="stat-label">Perfect 10s</span></div>
        <div class="stat-card"><span class="stat-num">${avgGuesses}</span><span class="stat-label">Avg guesses</span></div>
        <div class="stat-card"><span class="stat-num">${streakLabel}</span><span class="stat-label">Streak</span></div>
        <div class="stat-card"><span class="stat-num">${totalScore}</span><span class="stat-label">Total points</span></div>
      </div>
      <h3>Recent form <span class="muted-sm">(last ${recent.length})</span></h3>
      ${trend}
      <div class="trend-legend"><span class="dot hot"></span>8+ <span class="dot mid"></span>5-7 <span class="dot cold"></span>0-4</div>
      <h3>Best categories</h3>
      <ul class="stat-list">${bestCats.map(c => `<li><span>${c.c}</span><strong>${c.avg.toFixed(1)}</strong></li>`).join('')}</ul>
      <h3>Nemesis categories</h3>
      <ul class="stat-list">${worstCats.map(c => `<li><span>${c.c}</span><strong>${c.avg.toFixed(1)}</strong></li>`).join('')}</ul>
      <h3>By day of week <span class="muted-sm">(avg score)</span></h3>
      ${dowHtml}
      <h3>Clutch factor</h3>
      <p>💪 ${blowouts} blowout win${blowouts === 1 ? '' : 's'} (3+ pts) · 😰 ${nailbiters} nail-biter${nailbiters === 1 ? '' : 's'} (1 pt)</p>
    `;
  }

  // ---------- Archive ----------
  function renderArchive(filter) {
    const list = $('archive-list');
    list.innerHTML = '';
    const cats = window.DAILY_TEN_CATEGORIES;
    const q = (filter || '').toLowerCase().trim();
    let shown = 0;
    for (let i = dayIdx - 1; i >= 0 && i >= dayIdx - 27; i--) {
      const { cat, puzzleNumber } = categoryForDay(i);
      if (q && !cat.title.toLowerCase().includes(q)) continue;
      const d = new Date(Date.parse(EPOCH_ISO + 'T12:00:00') + i * 86400000);
      const iso = d.toISOString().slice(0, 10);
      const div = document.createElement('div');
      div.className = 'archive-item';
      div.innerHTML = `<div class="d">#${puzzleNumber} · ${iso}</div><div class="t">${escapeHtml(cat.title)}</div>`;
      list.appendChild(div);
      shown++;
    }
    if (!shown) list.innerHTML = q ? `<p class="muted">No puzzles match "${escapeHtml(filter)}".</p>` : '<p class="muted">No past puzzles yet.</p>';
  }
  // wire up archive search
  document.addEventListener('DOMContentLoaded', () => {
    const s = document.getElementById('archive-search');
    if (s) s.addEventListener('input', () => renderArchive(s.value));
  });

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

  // ---------- Picker wiring ----------
  $('confirm-yes').onclick = () => {
    const picked = pendingName;
    hidePicker();
    $('name-confirm').classList.add('hidden');
    if (picked !== player) {
      // Switching players: clear the previous player's in-memory state so
      // nothing leaks into the new player's slot, then restore the picked
      // player's own saved progress for today if it's on this device.
      player = picked;
      resetGameState();
      try {
        const raw = localStorage.getItem('guessten-progress');
        if (raw) {
          const data = JSON.parse(raw);
          if (data.day === dayISO && data.player === picked) loadFromStorage();
        }
      } catch (e) {}
    }
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
  // Clear in-memory game state. Called ONLY on an explicit fresh start
  // (picking a different player, midnight rollover) — never at the top of
  // startGame, where it would wipe progress just restored from URL/storage.
  function resetGameState() {
    finished = false;
    submitted = false;
    guessed = {};
    wrongGuesses = [];
    outsideHits = [];
    guessesUsed = 0;
    revealed = false;
  }

  async function startGame() {
    updateBadge();
    resetIdleTimer(); // start the "hurry up" nag timer
    $('puzzle-num').textContent = 'Puzzle #' + puzzle.puzzleNumber;
    $('puzzle-date').textContent = dayISO;
    $('category-title').textContent = puzzle.cat.title;
    // category difficulty badge — shows only once there's real history
    const diffBadge = $('difficulty-badge');
    diffBadge.classList.add('hidden');
    diffBadge.classList.remove('diff-brutal', 'diff-chill', 'diff-avg');
    if (window.DTDB && window.DTDB.isReady()) {
      window.DTDB.fetchCategoryAverages().then(avgs => {
        const info = avgs[puzzle.cat.title];
        if (!info || info.plays < 8) return; // not enough data yet — stay quiet
        if (info.avg <= 4) { diffBadge.textContent = '🔥 Historically brutal'; diffBadge.classList.add('diff-brutal'); }
        else if (info.avg >= 7) { diffBadge.textContent = '😌 Historically chill'; diffBadge.classList.add('diff-chill'); }
        else { diffBadge.textContent = '➖ Average difficulty'; diffBadge.classList.add('diff-avg'); }
        diffBadge.classList.remove('hidden');
      }).catch(() => diffBadge.classList.add('hidden'));
    }
    const src = $('source-link');
    src.innerHTML = puzzle.cat.source_url
      ? `Data: <a href="${puzzle.cat.source_url}" target="_blank" rel="noopener">${escapeHtml(puzzle.cat.source)}</a>`
      : `Data: ${escapeHtml(puzzle.cat.source)}`;

    // Replay lockout: if this player already submitted today, show their
    // completed run (locked) instead of letting them play again. Runs even
    // for a restored finished game, so an already-submitted score shows the
    // locked screen rather than a redundant submit button.
    if (window.DTDB && window.DTDB.isReady()) {
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
      // Restored finished-but-unsubmitted game: show the finish screen with
      // the full recap and the manual submit button (no auto-submit).
      $('game-area').classList.add('hidden');
      const fa = $('finish-area');
      fa.classList.remove('hidden');
      $('finish-title').textContent = revealed ? 'Answers revealed' : 'Puzzle complete';
      $('finish-score').textContent = `${player}: ${score()}/10`;
      $('finish-grid').textContent = gridText();
      renderRecap(revealed);
      resetSubmitUI();
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
    st.classList.remove('hidden');
    st.textContent = hasGuessData
      ? 'Your score is locked in for today. See you tomorrow.'
      : 'Your score is locked in for today. Play on the same device to see your full recap. See you tomorrow.';
    st.className = 'ok';
    // show the full recap: category, correct answers, misses
    renderRecap(row.revealed);
    // Already submitted — hide the submit button, enable copy/share
    const submitBtn2 = $('submit-score-btn');
    if (submitBtn2) submitBtn2.classList.add('hidden');
    ['copy-result-btn', 'share-image-btn'].forEach(id => {
      const b = $(id);
      if (!b) return;
      b.disabled = false;
      b.style.opacity = '1';
      b.style.display = '';
    });
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
    // Archive renders lazily on first tab tap (faster boot)
    // Flush any queued offline scores
    flushQueue();
    // Hide the loading spinner now that the app is ready
    document.getElementById('app-loader').classList.add('hidden');
    // Midnight rollover watcher: if the app is open at Chicago midnight,
    // auto-switch to the new day's puzzle without requiring a refresh
    setInterval(() => {
      const nowISO = chicagoTodayISO();
      if (nowISO !== dayISO) {
        dayISO = nowISO;
        dayIdx = dayIndexFor(dayISO);
        puzzle = categoryForDay(dayIdx);
        // clear yesterday's progress
        try {
          localStorage.removeItem('guessten-' + player + '-' + nowISO);
        } catch (e) {}
        hidePicker();
        resetGameState();
        startGame();
        mascotSay("New day, new puzzle! Fresh start — don't blow it.");
      }
    }, 30000);
  }

  document.addEventListener('DOMContentLoaded', boot);

  // ---------- Dark mode toggle ----------
  const themeBtn = document.getElementById('theme-toggle');
  function applyTheme(dark) {
    document.body.classList.toggle('dark', dark);
    if (themeBtn) themeBtn.textContent = dark ? '☀️' : '🌙';
    try { localStorage.setItem('guessten-theme', dark ? 'dark' : 'light'); } catch (e) {}
  }
  // restore saved preference (default: follow system)
  (function initTheme() {
    let dark = false;
    try {
      const saved = localStorage.getItem('guessten-theme');
      if (saved) dark = saved === 'dark';
      else if (window.matchMedia) dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (e) {}
    applyTheme(dark);
  })();
  if (themeBtn) themeBtn.onclick = () => applyTheme(!document.body.classList.contains('dark'));

  // Register service worker for installable home-screen app + offline.
  // Force an update check on every load so a stale cached version can never
  // linger — critical for score-submit reliability.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        if (reg && reg.update) reg.update().catch(() => {});
      }).catch(() => {});
    });
  }
})();
