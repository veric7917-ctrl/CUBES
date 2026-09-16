import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

test('two independent students, private live streams and reconnect', async t => {
  const server = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const controllers = [];
  t.after(() => { controllers.forEach(c => c.abort()); server.closeAllConnections(); server.close(); });
  const post = async (path, data) => { const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ round: 1, ...data }) }); return { status: r.status, data: await r.json() }; };
  async function stream(session) {
    const controller = new AbortController(); controllers.push(controller);
    const response = await fetch(`${base}/api/events?code=${session.code}&token=${session.token}`, { signal: controller.signal });
    assert.equal(response.status, 200);
    const reader = response.body.getReader(); let buffer = '';
    return { controller, async until(predicate) {
      const timeout = setTimeout(() => controller.abort(), 4000);
      try {
        while (true) {
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
            if (block.startsWith('data: ')) { const state = JSON.parse(block.slice(6)); if (predicate(state)) return state; }
          }
          const { value, done } = await reader.read(); if (done) throw new Error('Stream closed');
          buffer += new TextDecoder().decode(value);
        }
      } finally { clearTimeout(timeout); }
    } };
  }
  const created = await post('/api/rooms', {}); assert.equal(created.status, 201);
  const teacher = created.data; assert.match(teacher.code, /^[A-Z2-9]{5}$/);
  const teacherStream = await stream(teacher);
  assert.deepEqual((await teacherStream.until(s => true)).students, []);
  const anna = (await post('/api/join', { code: teacher.code.toLowerCase(), name: 'Anna' })).data;
  const max = (await post('/api/join', { code: teacher.code, name: 'Max' })).data;
  assert.equal((await post('/api/join', { code: teacher.code, name: 'Third' })).status, 409);
  const annaStream = await stream(anna), maxStream = await stream(max);
  const initial = await annaStream.until(s => true);
  assert.equal(initial.student.name, 'Anna'); assert.equal(initial.students, undefined);
  await maxStream.until(s => true);
  const both = await teacherStream.until(s => s.students.length === 2 && s.students.every(x => x.online));
  assert.ok(both.students.every(s => !('token' in s)));
  const positions = [1, 1, 3, 2];
  assert.equal((await post('/api/state', { ...anna, positions, revision: 1 })).status, 200);
  const changed = await teacherStream.until(s => s.students[0].revision === 1);
  assert.deepEqual(changed.students[0].positions, positions);
  assert.deepEqual(changed.students[1].positions, [0, 0, 0, 0]);
  await post('/api/state', { ...max, positions: [2, 0, 1, 3], revision: 1 });
  const maxOwn = await maxStream.until(s => s.student.revision === 1);
  assert.equal(maxOwn.students, undefined); assert.equal(maxOwn.student.name, 'Max');
  await post('/api/state', { ...anna, positions: [3, 3, 3, 3], revision: 10 });
  const stale = await post('/api/state', { ...anna, positions: [0, 0, 0, 0], revision: 2 });
  assert.deepEqual(stale.data.positions, [3, 3, 3, 3]);
  assert.equal((await post('/api/state', { ...teacher, positions, revision: 11 })).status, 403);
  assert.equal((await post('/api/state', { ...anna, positions: [4, 0, 0, 0], revision: 11 })).status, 400);
  annaStream.controller.abort();
  await teacherStream.until(s => !s.students[0].online);
  const reconnect = await stream(anna);
  assert.deepEqual((await reconnect.until(s => true)).student.positions, [3, 3, 3, 3]);
  assert.equal((await post('/api/join', { code: 'XXXXX', name: 'A' })).status, 404);
  const finished = await post('/api/bell', { ...anna, positions, revision: 11 });
  assert.equal(finished.data.finished, true);
  const waiting = await reconnect.until(s => s.student.finished);
  assert.equal(waiting.students, undefined, 'first student cannot see partner');
  const partnerWaiting = await maxStream.until(s => s.student.revision === 1 && !s.student.finished);
  assert.equal(partnerWaiting.students, undefined, 'partner cannot see first finished question');
  assert.equal((await post('/api/state', { ...anna, positions: [0, 0, 0, 0], revision: 12 })).status, 409);
  assert.equal((await post('/api/state', { ...max, positions: [2, 1, 0, 3], revision: 2 })).status, 200);
  await teacherStream.until(s => s.students[0].finished && !s.students[1].finished);
  assert.equal((await post('/api/new-round', max)).status, 403);
  assert.equal((await post('/api/bell', { ...max, positions: [2, 1, 0, 3], revision: 3 })).status, 200);
  for (const connection of [reconnect, maxStream]) {
    const reveal = await connection.until(s => s.students?.every(student => student.finished));
    assert.equal(reveal.students.length, 2);
    assert.deepEqual(reveal.students[0].positions, positions);
  }
  const duplicate = await post('/api/bell', { ...anna, positions: [0, 0, 0, 0], revision: 99 });
  assert.deepEqual(duplicate.data.positions, positions, 'repeat bell cannot overwrite locked cubes');
  const reset = await post('/api/new-round', teacher);
  assert.equal(reset.data.round, 2);
  assert.ok(reset.data.students.every(student => !student.finished));
  for (const connection of [reconnect, maxStream]) {
    const next = await connection.until(s => s.round === 2);
    assert.equal(next.students, undefined); assert.equal(next.student.finished, false);
  }
  assert.equal((await post('/api/bell', { ...anna, positions, revision: 50 })).status, 409);
  assert.equal((await post('/api/state', { ...anna, positions, revision: 50 })).status, 409);
  assert.equal((await post('/api/state', { ...anna, round: 2, positions: [0, 0, 0, 0], revision: 1 })).status, 200);
});
