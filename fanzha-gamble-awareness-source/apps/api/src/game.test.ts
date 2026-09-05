import assert from 'node:assert/strict';
import test from 'node:test';
import { makeOutcome, payoutFor } from './game.js';

test('教学脚本第一局展示可控中奖', () => {
  const outcome = makeOutcome(1, true);
  assert.equal(outcome.multiplier, 5);
  assert.equal(outcome.reels.every((column) => column[1] === '中'), true);
});

test('派彩金额只计算虚拟积分', () => {
  assert.equal(payoutFor(20, 3), 60);
});
