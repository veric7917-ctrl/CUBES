import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CUBE_SETS } from '../public/levels.js';

test('Exact level definitions: unchanged Level 1 and expanded question words in Levels 2 and 3', () => {
  const question = ['WHAT', 'WHEN', 'WHERE', 'HOW'];
  const subject = ['YOU', 'THEY', 'HE', 'SHE'];
  const originalVerbs = ['PLAY', 'HELP', 'READ', 'EAT'];
  assert.deepEqual(CUBE_SETS[1], [question, ['DO', 'DOES', 'DO', 'DOES'], subject, originalVerbs]);
  assert.deepEqual(CUBE_SETS[2], [[...question, 'WHY', 'WHAT TIME'], ['DO', 'DOES', 'DID', 'CAN', 'WILL'], subject, [...originalVerbs, 'GO', 'DO']]);
  assert.deepEqual(CUBE_SETS[3], [[...question, 'WHY', 'WHAT TIME'], ['DO', 'DOES', 'IS', 'ARE', 'HAVE', 'HAS'], subject,
    ['PLAY', 'PLAYING', 'PLAYED', 'HELP', 'HELPING', 'HELPED', 'READ', 'READING', 'READ', 'EAT', 'EATING', 'EATEN', 'GO', 'GOING', 'GONE', 'DO', 'DOING', 'DONE']]);
});

test('Level 4: five fixed positions, three blank states and exact manual forms', () => {
  assert.deepEqual(CUBE_SETS[4], [['WHO'], ['', 'DO', 'DOES', 'DID'],
    ['', 'HELPS', 'HELPED', 'PLAYS', 'PLAYED', 'READS', 'READ', 'LIKES', 'LIKED', 'CALLS', 'CALLED', 'SEES', 'SAW'],
    ['TOM', 'ANNA', 'THE BOYS', 'THE GIRLS'], ['', 'HELP', 'PLAY', 'READ', 'LIKE', 'CALL', 'SEE']]);
});
