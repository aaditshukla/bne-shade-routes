// Self-check: npm run check:time
import assert from 'node:assert/strict';
import { slotAt, slotTime } from './time.ts';

const bne = (hhmm: string) => new Date(`2026-11-21T${hhmm}:00+10:00`);
assert.equal(slotAt(bne('06:00')), 0);
assert.equal(slotAt(bne('06:14')), 0);
assert.equal(slotAt(bne('06:15')), 1);
assert.equal(slotAt(bne('16:30')), 42);
assert.equal(slotAt(bne('18:30')), 50);
assert.equal(slotAt(bne('23:59')), 50); // late evening clamps to the last slot
assert.equal(slotAt(bne('00:10')), 0); // after midnight clamps to the first
assert.equal(slotAt(new Date('2026-11-20T23:00:00Z')), 12); // 09:00 Brisbane is 23:00 UTC the day before

assert.equal(slotTime(0), '6:00 am');
assert.equal(slotTime(23), '11:45 am');
assert.equal(slotTime(24), '12:00 pm');
assert.equal(slotTime(42), '4:30 pm');
assert.equal(slotTime(50), '6:30 pm');

console.log('time self-check passed');
