import { CUBE_SETS } from './levels.js';
let currentLevel = 1;
function showLevel(level) {
  currentLevel = level;
  document.querySelector('#app').dataset.level = level;
  document.querySelector('footer span:last-child').textContent = `${level === 4 ? 'Five' : 'Four'} cubes. Endless possibilities.`;
  document.querySelector('.level').textContent = `LEVEL ${String(level).padStart(2, '0')} · ${level === 4 ? 'WHO QUESTIONS' : level === 3 ? 'PRESENT FORMS' : 'ENGLISH'}`;
}
const labels = ['Question word', 'Auxiliary', 'Subject', 'Verb'];
const app = document.querySelector('#app');
let session, events, own, localRevision = 0, sentRevision = 0, sending = false, retry, online = false;
let round = 0, bellPending = false, bellSending = false, bellRetry, audioContext;
const cards = new Map();
try { session = JSON.parse(sessionStorage.getItem('question-cubes')); } catch {}
async function api(path, data) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
  return result;
}
function cubeRow(positions, interactive = false, onRotate = null) {
  const row = document.createElement('div'); row.className = currentLevel === 4 ? 'cube-row five-cubes' : 'cube-row';
  const cubeLabels = currentLevel === 4 ? ['Question word', 'Auxiliary', 'Subject-question verb', 'Noun', 'Base verb'] : labels;
  const cubes = CUBE_SETS[currentLevel].map((faces, index) => {
    const wrap = document.createElement('div'); wrap.className = `cube-wrap color-${currentLevel === 4 ? [0, 1, 3, 2, 3][index] : index}`;
    const control = document.createElement(interactive ? 'button' : 'div'); control.className = 'cube-control';
    if (interactive) control.type = 'button';
    const tilt = document.createElement('div'); tilt.className = 'cube-tilt';
    const cube = document.createElement('div'); cube.className = 'cube'; cube.setAttribute('aria-hidden', 'true');
    Array.from({ length: 4 }, (_, face) => faces[face % faces.length]).forEach((word, face) => { const el = document.createElement('div'); el.className = `face face-${face}`; el.textContent = word; cube.append(el); });
    for (const side of ['left', 'right']) { const el = document.createElement('div'); el.className = `face cap-${side}`; cube.append(el); }
    tilt.append(cube); control.append(tilt); wrap.append(control);
    row.append(wrap);
    let position = positions[index], turns = position;
    // Virtual states share the same four physical faces. Recycle only hidden faces
    // between quarter-turns so the current front and incoming top never pop.
    const virtual = faces.length > 4;
    let shown = position, pendingTurns = 0, rotating = false, turnTimeout;
    const paintVirtualFaces = () => {
      for (const offset of [-1, 0, 1, 2]) {
        cube.querySelector(`.face-${(turns + offset + 4) % 4}`).textContent = faces[(shown + offset + faces.length) % faces.length];
      }
    };
    const finishTurn = () => {
      if (!rotating) return;
      clearTimeout(turnTimeout); rotating = false;
      shown = (shown + 1) % faces.length;
      paintVirtualFaces(); advanceVirtual();
    };
    const advanceVirtual = () => {
      if (rotating || !pendingTurns) return;
      pendingTurns--; rotating = true; turns++;
      cube.style.transform = `rotateX(${-turns * 90}deg)`;
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) finishTurn();
      else turnTimeout = setTimeout(finishTurn, 200);
    };
    if (virtual) {
      paintVirtualFaces();
      cube.addEventListener('transitionend', event => { if (event.target === cube && event.propertyName === 'transform') finishTurn(); });
    }
    const update = next => {
      const steps = (next - position + faces.length) % faces.length;
      position = next;
      if (virtual) { pendingTurns += steps; advanceVirtual(); }
      else { turns += steps; cube.style.transform = `rotateX(${-turns * 90}deg)`; }
      control.setAttribute('aria-label', `${cubeLabels[index]}: ${faces[next]}${interactive ? '. Rotate cube' : ''}`);
    };
    cube.style.transform = `rotateX(${-turns * 90}deg)`;
    update(position);
    if (interactive) control.addEventListener('click', () => { const next = (position + 1) % faces.length; update(next); onRotate?.(index, next); });
    return update;
  });
  return { element: row, update: positions => positions.forEach((p, i) => cubes[i](p)) };
}
function home() {
  showLevel(1);
  app.className = 'home';
  app.innerHTML = `<section class="hero"><div class="eyebrow"><span></span> THE CONVERSATION STARTS HERE</div><h1>Good questions.<br><em>One turn away.</em></h1><p>Turn a cube. Find your words. Start talking.<br>A shared space for your live English lesson.</p><div id="preview"></div><div class="preview-note">GO ON, GIVE THEM A TURN <span>↗</span></div></section><section class="entry"><div class="entry-heading"><span class="tiny-cube">◈</span><span></span></div><div class="teacher-entry"><h2>Here to teach?</h2><p>Create a room and watch your students’ cubes move live.</p><button id="create" class="primary">Create a room <span>↗</span></button></div><div class="divider"><span>OR JOIN YOUR TEACHER</span></div><form id="join"><h2>Let’s get talking.</h2><label for="code">Room code</label><input id="code" name="code" placeholder="e.g. K7M4P" maxlength="5" pattern="[A-Za-z2-9]{5}" autocomplete="off" required><label for="name">Your name</label><input id="name" name="name" placeholder="What should we call you?" maxlength="30" autocomplete="given-name" required><button class="secondary" type="submit">Join room <span>→</span></button></form><p id="error" class="error" role="alert"></p><div class="entry-foot"><span class="small-dot"></span> Just you, your teacher & the cubes.</div></section>`;
  document.querySelector('#preview').append(cubeRow(CUBE_SETS[currentLevel].map(() => 0), true).element);
  const choice = document.createElement('fieldset'); choice.className = 'level-choice';
  choice.innerHTML = '<legend>Room level</legend><label><input type="radio" name="room-level" value="1" checked> LEVEL 1</label><label><input type="radio" name="room-level" value="2"> LEVEL 2</label><label><input type="radio" name="room-level" value="3"> LEVEL 3 — PRESENT FORMS</label><label><input type="radio" name="room-level" value="4"> LEVEL 4 — WHO QUESTIONS</label>';
  document.querySelector('#create').before(choice);
  choice.onchange = () => {
    showLevel(Number(choice.querySelector('input:checked').value));
    document.querySelector('#preview').replaceChildren(cubeRow(CUBE_SETS[currentLevel].map(() => 0), true).element);
  };
  const code = new URLSearchParams(location.search).get('room');
  if (code) document.querySelector('#code').value = code.toUpperCase().slice(0, 5);
  async function enter(button, path, data) {
    button.disabled = true; document.querySelector('#error').textContent = '';
    try { session = await api(path, data); sessionStorage.setItem('question-cubes', JSON.stringify(session)); roomScreen(); }
    catch (e) { document.querySelector('#error').textContent = e.message; button.disabled = false; }
  }
  document.querySelector('#create').onclick = e => enter(e.currentTarget, '/api/rooms', { level: Number(choice.querySelector('input:checked').value) });
  document.querySelector('#join').onsubmit = e => { e.preventDefault(); enter(e.target.querySelector('button'), '/api/join', { code: e.target.elements.namedItem('code').value, name: e.target.elements.namedItem('name').value }); };
}
function status(text, connected = false) { const el = document.querySelector('#status'); if (el) { el.textContent = text; el.classList.toggle('connected', connected); } }
function roomScreen() {
  showLevel(session.level || 1);
  cards.clear(); own = null; localRevision = 0; sentRevision = 0; round = 0; bellPending = false;
  clearTimeout(bellRetry);
  const teacher = session.role === 'teacher';
  app.className = teacher ? 'room teacher-room' : 'room student-room';
  app.innerHTML = `<div class="room-top"><span class="eyebrow">${teacher ? 'TEACHER SPACE' : ''}</span><div class="room-actions"><span id="status" role="status">Connecting…</span><button id="leave" class="text-button">Leave room ↗</button></div></div>${teacher ? '<div class="teacher-heading"><div><h1>A room for conversation.</h1><p>Share the code. Watch each student’s words take shape.</p></div><div class="room-code"><span>ROOM CODE</span><strong id="room-code"></strong><button id="copy" class="text-button">Copy invite link ↗</button></div></div><div id="students" class="students"></div><p class="room-hint">You lead the conversation. They turn the cubes.</p>' : '<div id="student-area"><p class="loading">Finding your cubes…</p></div>'}<p id="room-error" class="error" role="alert"></p>`;
  document.querySelector('#leave').onclick = () => { events?.close(); clearTimeout(retry); clearTimeout(bellRetry); sessionStorage.removeItem('question-cubes'); session = null; history.replaceState(null, '', '/'); home(); };
  if (teacher) {
    const next = document.createElement('button'); next.id = 'new-round'; next.className = 'primary new-round'; next.textContent = 'NEW ROUND';
    document.querySelector('.teacher-heading > div').append(next);
    next.onclick = async () => {
      next.disabled = true;
      try { await api('/api/new-round', { ...session, round }); }
      catch (error) { document.querySelector('#room-error').textContent = error.message; }
      finally { next.disabled = false; }
    };
    document.querySelector('#room-code').textContent = session.code;
    document.querySelector('#copy').onclick = async e => { try { await navigator.clipboard.writeText(`${location.origin}/?room=${session.code}`); e.target.textContent = 'Link copied ✓'; } catch { document.querySelector('#room-error').textContent = `Share this code: ${session.code}`; } };
    renderStudents([]);
  }
  events?.close();
  events = new EventSource(`/api/events?code=${encodeURIComponent(session.code)}&token=${encodeURIComponent(session.token)}`);
  events.onopen = () => { online = true; status('Connected', true); };
  events.onerror = () => { online = false; status('Reconnecting…'); document.querySelector('#room-error').textContent = 'Connection interrupted. Reconnecting automatically. If the server restarted, leave and create or join a new room.'; };
  events.onmessage = e => {
    document.querySelector('#room-error').textContent = '';
    const state = JSON.parse(e.data);
    showLevel(state.level);
    if (teacher) { round = state.round; renderStudents(state.students); return; }
    const changedRound = round !== state.round;
    round = state.round;
    if (changedRound) { bellPending = false; clearTimeout(bellRetry); clearTimeout(retry); }
    if (!own) {
      own = state.student; localRevision = own.revision; sentRevision = own.revision;
      const area = document.querySelector('#student-area'); area.innerHTML = '<section id="own-question"><div class="student-heading"><h1 id="student-name"></h1></div><div id="my-cubes"></div></section><section id="partner-question" hidden></section><div class="bell-area"><button id="bell" class="bell-button" aria-label="Ring bell — finish my question">🔔</button><p id="bell-status" role="status">Tap the bell when your question is finished.</p></div>';
      document.querySelector('#student-name').textContent = own.name;
      const row = cubeRow(own.positions, true, (index, next) => { own.positions[index] = next; localRevision++; flush(); });
      document.querySelector('#my-cubes').append(row.element); cards.set(own.id, row);
      document.querySelector('#bell').onclick = () => {
        if (own.finished || bellPending) return;
        bellPending = true; localRevision++; playDing(); updateLock(); ringBell();
      };
    } else if (changedRound || state.student.finished || state.student.revision > localRevision) {
      own.positions = state.student.positions; localRevision = sentRevision = state.student.revision; cards.get(own.id).update(own.positions);
    }
    own.finished = state.student.finished;
    if (own.finished) { bellPending = false; clearTimeout(bellRetry); }
    updateLock();
    renderPartner(state.students);
    if (!own.finished && !bellPending && localRevision > sentRevision) flush();
  };
}
function renderStudents(students) {
  const container = document.querySelector('#students');
  container.querySelectorAll('.empty-student').forEach(el => el.remove());
  students.forEach((student, index) => {
    let card = cards.get(student.id);
    if (!card) {
      const el = document.createElement('section'); el.className = 'student-card';
      el.innerHTML = `<div class="card-top"><h2></h2><span class="finish-state"></span><span class="presence"></span></div>`;
      const row = cubeRow(student.positions); el.append(row.element); container.append(el); card = { el, row }; cards.set(student.id, card);
    }
    card.el.querySelector('h2').textContent = student.name;
    card.el.querySelector('.finish-state').textContent = student.finished ? '🔔 Finished · Locked' : '';
    card.el.querySelector('.presence').textContent = student.online ? 'Live' : 'Offline';
    card.el.querySelector('.presence').classList.toggle('connected', student.online);
    card.row.update(student.positions);
  });
  for (let i = students.length; i < 2; i++) {
    const empty = document.createElement('section'); empty.className = 'student-card empty-student';
    empty.innerHTML = `<span class="empty-icon">◈</span><h2>Space for student ${i + 1}</h2><p>Their cubes will appear when they join.</p><span class="waiting">WAITING FOR A CONNECTION</span>`; container.append(empty);
  }
}
async function flush() {
  if (sending || !own || !session || own.finished || bellPending || localRevision <= sentRevision) return;
  clearTimeout(retry); sending = true;
  const active = session, activeRound = round, revision = localRevision, positions = [...own.positions];
  try {
    await api('/api/state', { ...active, round: activeRound, positions, revision });
    if (session === active && round === activeRound) { sentRevision = Math.max(sentRevision, revision); status(online ? 'Connected' : 'Reconnecting…', online); }
  } catch (error) { if (session === active && round === activeRound && error.status !== 409) { status('Syncing…'); retry = setTimeout(flush, 1500); } }
  finally { sending = false; }
  if (session === active && (round !== activeRound || sentRevision === revision) && localRevision > sentRevision) flush();
}
function updateLock() {
  const locked = own.finished || bellPending;
  document.querySelectorAll('#my-cubes button').forEach(button => { button.disabled = locked; });
  document.querySelector('#own-question').classList.toggle('locked', locked);
  document.querySelector('#bell').disabled = locked;
  document.querySelector('#bell-status').textContent = own.finished ? '🔒 Question locked. Waiting for your partner…' : bellPending ? '🔒 Question locked. Sending bell…' : 'Tap the bell when your question is finished.';
}
function renderPartner(students) {
  const partner = students?.find(student => student.id !== own.id);
  const area = document.querySelector('#partner-question');
  app.classList.toggle('comparing', Boolean(partner));
  area.hidden = !partner;
  if (!partner) { area.replaceChildren(); delete area.dataset.student; return; }
  if (area.dataset.student !== partner.id) {
    area.replaceChildren();
    const heading = document.createElement('div'); heading.className = 'student-heading';
    const name = document.createElement('h2'); name.textContent = partner.name; heading.append(name);
    area.append(heading, cubeRow(partner.positions).element); area.dataset.student = partner.id;
  }
  document.querySelector('#bell-status').textContent = 'Both finished! Compare your questions.';
}
async function ringBell() {
  if (bellSending || !bellPending || !session) return;
  bellSending = true;
  const active = session, activeRound = round;
  try {
    await api('/api/bell', { ...active, round: activeRound, positions: [...own.positions], revision: localRevision });
  } catch (error) {
    if (session === active && round === activeRound && error.status !== 409) {
      document.querySelector('#bell-status').textContent = '🔒 Question locked. Reconnecting to send your bell…';
      bellRetry = setTimeout(ringBell, 1500);
    }
  } finally { bellSending = false; }
  if (session === active && round !== activeRound && bellPending) ringBell();
}
function playDing() {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    audioContext.resume();
    const start = audioContext.currentTime;
    [[1046.5, .18], [2093, .07], [2810, .025]].forEach(([frequency, volume]) => {
      const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(volume, start + .005);
      gain.gain.exponentialRampToValueAtTime(.0001, start + .8);
      oscillator.connect(gain); gain.connect(audioContext.destination);
      oscillator.start(start); oscillator.stop(start + .85);
    });
  } catch { /* Bell submission still works when audio is unavailable. */ }
}
if (session?.token && session?.code) roomScreen(); else home();
