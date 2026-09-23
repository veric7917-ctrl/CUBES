import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CUBE_SETS } from '../public/levels.js';
import { createApp } from '../server.js';

for (const selectedLevel of [undefined, 1, 2, 3, 4]) {
test(`Level ${selectedLevel ?? '1 (default)'}: two independent students, private live streams and reconnect`, async t => {
  const expectedLevel = selectedLevel ?? 1;
  const fit = positions => expectedLevel === 4 && positions.length === 4 ? [...positions, 0] : positions;
  const questionPosition = n => n % CUBE_SETS[expectedLevel][0].length;
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
            if (block.startsWith('data: ')) { const state = JSON.parse(block.slice(6)); assert.equal(state.level, expectedLevel); if (predicate(state)) return state; }
          }
          const { value, done } = await reader.read(); if (done) throw new Error('Stream closed');
          buffer += new TextDecoder().decode(value);
        }
      } finally { clearTimeout(timeout); }
    } };
  }
  for (const level of [0, 5, '2', null]) assert.equal((await post('/api/rooms', { level })).status, 400);
  const created = await post('/api/rooms', { level: selectedLevel }); assert.equal(created.status, 201);
  assert.equal(created.data.level, expectedLevel);
  const other = await post('/api/rooms', { level: expectedLevel === 1 ? 2 : 1 });
  assert.notEqual(other.data.level, expectedLevel);
  const teacher = created.data; assert.match(teacher.code, /^[A-Z2-9]{5}$/);
  const teacherStream = await stream(teacher);
  assert.deepEqual((await teacherStream.until(s => true)).students, []);
  const anna = (await post('/api/join', { code: teacher.code.toLowerCase(), name: 'Anna', level: other.data.level })).data;
  const max = (await post('/api/join', { code: teacher.code, name: 'Max' })).data;
  assert.equal(anna.level, expectedLevel); assert.equal(max.level, expectedLevel);
  assert.equal((await post('/api/join', { code: teacher.code, name: 'Third' })).status, 409);
  const annaStream = await stream(anna), maxStream = await stream(max);
  const initial = await annaStream.until(s => true);
  assert.equal(initial.student.name, 'Anna'); assert.equal(initial.students, undefined);
  await maxStream.until(s => true);
  const both = await teacherStream.until(s => s.students.length === 2 && s.students.every(x => x.online));
  assert.ok(both.students.every(s => !('token' in s)));
  const positions = CUBE_SETS[expectedLevel].map(faces => faces.length - 1);
  assert.equal((await post('/api/state', { ...anna, positions, revision: 1 })).status, 200);
  const changed = await teacherStream.until(s => s.students[0].revision === 1);
  assert.deepEqual(changed.students[0].positions, positions);
  assert.deepEqual(changed.students[1].positions, fit([0, 0, 0, 0]));
  await post('/api/state', { ...max, positions: fit([questionPosition(2), 0, 1, 3]), revision: 1 });
  const maxOwn = await maxStream.until(s => s.student.revision === 1);
  assert.equal(maxOwn.students, undefined); assert.equal(maxOwn.student.name, 'Max');
  await post('/api/state', { ...anna, positions: fit([questionPosition(3), 3, 3, 3]), revision: 10 });
  const stale = await post('/api/state', { ...anna, positions: fit([0, 0, 0, 0]), revision: 2 });
  assert.deepEqual(stale.data.positions, fit([questionPosition(3), 3, 3, 3]));
  assert.equal((await post('/api/state', { ...teacher, positions, revision: 11 })).status, 403);
  assert.equal((await post('/api/state', { ...anna, positions: fit([CUBE_SETS[expectedLevel][0].length, 0, 0, 0]), revision: 11 })).status, 400);
  assert.equal((await post('/api/state', { ...anna, positions: fit([0, CUBE_SETS[expectedLevel][1].length, 0, 0]), revision: 11 })).status, 400);
  for (const index of CUBE_SETS[expectedLevel].map((_, i) => i).slice(2)) {
    const invalid = fit([0, 0, 0, 0]); invalid[index] = CUBE_SETS[expectedLevel][index].length;
    assert.equal((await post('/api/state', { ...anna, positions: invalid, revision: 11 })).status, 400);
  }
  if (expectedLevel === 1) assert.equal((await post('/api/state', { ...anna, positions: [0, 4, 0, 0], revision: 11 })).status, 400);
  annaStream.controller.abort();
  await teacherStream.until(s => !s.students[0].online);
  const reconnect = await stream(anna);
  assert.deepEqual((await reconnect.until(s => true)).student.positions, fit([questionPosition(3), 3, 3, 3]));
  assert.equal((await post('/api/join', { code: 'XXXXX', name: 'A' })).status, 404);
  const finished = await post('/api/bell', { ...anna, positions, revision: 11 });
  assert.equal(finished.data.finished, true);
  const waiting = await reconnect.until(s => s.student.finished);
  assert.equal(waiting.students, undefined, 'first student cannot see partner');
  const partnerWaiting = await maxStream.until(s => s.student.revision === 1 && !s.student.finished);
  assert.equal(partnerWaiting.students, undefined, 'partner cannot see first finished question');
  assert.equal((await post('/api/state', { ...anna, positions: fit([0, 0, 0, 0]), revision: 12 })).status, 409);
  assert.equal((await post('/api/state', { ...max, positions: fit([questionPosition(2), 1, 0, 3]), revision: 2 })).status, 200);
  await teacherStream.until(s => s.students[0].finished && !s.students[1].finished);
  assert.equal((await post('/api/new-round', max)).status, 403);
  assert.equal((await post('/api/bell', { ...max, positions: fit([questionPosition(2), 1, 0, 3]), revision: 3 })).status, 200);
  for (const connection of [reconnect, maxStream]) {
    const reveal = await connection.until(s => s.students?.every(student => student.finished));
    assert.equal(reveal.students.length, 2);
    assert.deepEqual(reveal.students[0].positions, positions);
  }
  const duplicate = await post('/api/bell', { ...anna, positions: fit([0, 0, 0, 0]), revision: 99 });
  assert.deepEqual(duplicate.data.positions, positions, 'repeat bell cannot overwrite locked cubes');
  const reset = await post('/api/new-round', { ...teacher, level: other.data.level });
  assert.equal(reset.data.level, expectedLevel);
  assert.equal(reset.data.round, 2);
  assert.ok(reset.data.students.every(student => !student.finished));
  for (const connection of [reconnect, maxStream]) {
    const next = await connection.until(s => s.round === 2);
    assert.equal(next.students, undefined); assert.equal(next.student.finished, false);
  }
  assert.equal((await post('/api/bell', { ...anna, positions, revision: 50 })).status, 409);
  assert.equal((await post('/api/state', { ...anna, positions, revision: 50 })).status, 409);
  assert.equal((await post('/api/state', { ...anna, round: 2, positions: fit([0, 0, 0, 0]), revision: 1 })).status, 200);
  for (const positions of [Array(3).fill(0), Array(expectedLevel === 4 ? 4 : 5).fill(0), Array(6).fill(0)]) {
    assert.equal((await post('/api/state', { ...anna, round: 2, positions, revision: 2 })).status, 400);
  }
  if (expectedLevel === 4) {
    let revision = 1;
    for (const positions of [[0, 0, 1, 0, 0], [0, 0, 12, 2, 0], [0, 2, 0, 1, 4], [0, 3, 0, 0, 5], [0, 2, 1, 1, 4], [0, 1, 0, 0, 1]]) {
      const result = await post('/api/state', { ...anna, round: 2, positions, revision: ++revision });
      assert.equal(result.status, 200);
      assert.deepEqual(result.data.positions, positions, 'manual combinations must not be corrected');
      const live = await teacherStream.until(s => s.round === 2 && s.students[0].revision === revision);
      assert.deepEqual(live.students[0].positions, positions);
    }
  }
  if (expectedLevel === 3) {
    let revision = 1;
    // Both identical READ labels remain separate server positions; invalid grammar is allowed.
    for (const positions of [[0, 1, 3, 11], [0, 5, 3, 9], [2, 2, 1, 13], [0, 4, 0, 6], [0, 4, 0, 8]]) {
      const result = await post('/api/state', { ...anna, round: 2, positions, revision: ++revision });
      assert.equal(result.status, 200);
      assert.deepEqual(result.data.positions, positions);
      const live = await teacherStream.until(s => s.round === 2 && s.students[0].revision === revision);
      assert.deepEqual(live.students[0].positions, positions);
    }
  }
});
}
