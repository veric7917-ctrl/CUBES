import http from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const token = () => randomBytes(24).toString('hex');
export function createApp() {
  const rooms = new Map();
  const publicStudent = s => ({ id: s.id, name: s.name, positions: s.positions, revision: s.revision, finished: s.finished, online: s.streams.size > 0 });
  const snapshot = (room, member) => member === room.teacher
    ? { role: 'teacher', code: room.code, round: room.round, students: [...room.students.values()].map(publicStudent) }
    : { role: 'student', code: room.code, round: room.round, student: publicStudent(member),
      ...(room.students.size === 2 && [...room.students.values()].every(s => s.finished)
        ? { students: [...room.students.values()].map(publicStudent) } : {}) };
  const send = (room, member) => {
    const data = `data: ${JSON.stringify(snapshot(room, member))}\n\n`;
    for (const stream of member.streams) stream.write(data);
  };
  const broadcast = (room, student) => { send(room, room.teacher); if (student) send(room, student); };
  const broadcastAll = room => { send(room, room.teacher); for (const student of room.students.values()) send(room, student); };
  const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
  const body = async req => {
    let raw = '';
    for await (const part of req) { raw += part; if (raw.length > 4096) fail(413, 'Request too large.'); }
    try { return JSON.parse(raw); } catch { fail(400, 'Invalid request.'); }
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) fail(403, 'Origin not allowed.');
        const data = await body(req);
        if (url.pathname === '/api/rooms') {
          if (rooms.size >= 500) fail(503, 'Please try again later.');
          let code;
          const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
          do { code = Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join(''); } while (rooms.has(code));
          const teacher = { token: token(), streams: new Set() };
          rooms.set(code, { code, teacher, round: 1, students: new Map(), touched: Date.now() });
          return json(201, { code, token: teacher.token, role: 'teacher' });
        }
        const room = rooms.get(String(data.code || '').trim().toUpperCase());
        if (!room) fail(404, 'Room not found. Check the code with your teacher.');
        room.touched = Date.now();
        if (url.pathname === '/api/join') {
          const name = typeof data.name === 'string' ? data.name.trim() : '';
          if (!name || name.length > 30) fail(400, 'Enter your name (up to 30 characters).');
          if (room.students.size >= 2) fail(409, 'Both student places are taken.');
          const student = { id: token(), token: token(), name, positions: [0, 0, 0, 0], revision: 0, finished: false, streams: new Set() };
          room.students.set(student.id, student);
          broadcast(room);
          return json(201, { code: room.code, token: student.token, role: 'student' });
        }
        if (url.pathname === '/api/new-round') {
          if (data.token !== room.teacher.token) fail(403, 'Only the teacher can start a new round.');
          if (data.round !== room.round) fail(409, 'The round has changed.');
          room.round++;
          for (const student of room.students.values()) { student.finished = false; student.revision = 0; }
          broadcastAll(room);
          return json(200, snapshot(room, room.teacher));
        }
        const student = [...room.students.values()].find(s => s.token === data.token);
        if (!student) fail(403, 'This session cannot change these cubes.');
        if (url.pathname === '/api/state' || url.pathname === '/api/bell') {
          if (data.round !== room.round) fail(409, 'The round has changed.');
          if (student.finished) {
            if (url.pathname === '/api/bell') return json(200, publicStudent(student));
            fail(409, 'These cubes are locked until the teacher starts a new round.');
          }
          if (!Array.isArray(data.positions) || data.positions.length !== 4 || !data.positions.every(n => Number.isInteger(n) && n >= 0 && n < 4) || !Number.isSafeInteger(data.revision) || data.revision < 1) fail(400, 'Invalid cube positions.');
          if (data.revision > student.revision) {
            student.positions = data.positions;
            student.revision = data.revision;
          }
          if (url.pathname === '/api/bell') { student.finished = true; broadcastAll(room); }
          else broadcast(room, student);
          return json(200, publicStudent(student));
        }
        fail(404, 'Not found.');
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        const room = rooms.get(url.searchParams.get('code'));
        if (!room) fail(404, 'This room has closed.');
        const credential = url.searchParams.get('token');
        const member = room.teacher.token === credential ? room.teacher : [...room.students.values()].find(s => s.token === credential);
        if (!member) fail(403, 'Session not found.');
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('retry: 1500\n\n');
        member.streams.add(res);
        room.touched = Date.now();
        send(room, member);
        if (member !== room.teacher) send(room, room.teacher);
        const heartbeat = setInterval(() => { res.write(': keepalive\n\n'); room.touched = Date.now(); }, 15000);
        res.on('close', () => { clearInterval(heartbeat); member.streams.delete(res); if (member !== room.teacher) send(room, room.teacher); });
        return;
      }
      const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
      if (req.method !== 'GET' || !files[url.pathname]) fail(404, 'Not found.');
      const [file, type] = files[url.pathname];
      const contents = await readFile(new URL(`./public/${file}`, import.meta.url));
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'" });
      res.end(contents);
    } catch (error) { if (!res.headersSent) json(error.status || 500, { error: error.status ? error.message : 'Server error. Please try again.' }); else res.end(); }
  });
  const cleanup = setInterval(() => { for (const [code, room] of rooms) if (Date.now() - room.touched > 12 * 60 * 60 * 1000) rooms.delete(code); }, 60000);
  cleanup.unref();
  server.on('close', () => clearInterval(cleanup));
  return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, '0.0.0.0', () => console.log(`Question Cubes: http://localhost:${port}`));
}
