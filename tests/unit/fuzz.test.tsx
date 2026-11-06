/**
 * Generated sessions, valid and hostile, through everything a file can reach: validation,
 * transcript, render, and the real Playback and SeekController with forced interleaving.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { projectFrom } from '../../bench/fixtures';
import { checkSeeking, fastHash, seekPositions } from '../../bench/harness';
import type { AnyAdapter, LogEntry } from '../../src/core/adapter';
import { canonicalJson } from '../../src/core/canonical';
import { Playback } from '../../src/core/playback';
import { validateProject } from '../../src/core/project';
import { nextRandom } from '../../src/core/random';
import { Timeline } from '../../src/core/timeline';
import { buildTranscript } from '../../src/core/transcript';
import { receiptAdapter } from '../../src/scenes/receipt/adapter';
import { retryAdapter } from '../../src/scenes/retry-queue/adapter';

const junk: unknown[] = [0, -1, 1, 2, 1e8, 1e8 + 1, 0.5, 1e308, '', 'e1', 'e2', 'e99', 'mina', 'theo', 'ana', '__proto__', 'constructor', 'equal', 'percent', 'amount', 'receipt', 'balances', 'job-1', 'job-2', true, false, null, [], {}, { a: 1 }];
const keys = ['id', 'mode', 'member', 'value', 'view', 'requestId', 'ok', 'healthy', 'maxAttempts', 'baseDelayMs', 'jitterPercent', 'job', 'attempt', 'status'];

/** Random commands, half of them nudged toward valid. Only accepted ones reach the log. */
function generate(adapter: AnyAdapter, seed: number, attempts: number): LogEntry[] {
  let rng = seed;
  const roll = (k: number) => {
    const next = nextRandom(rng);
    rng = next.rng;
    return Math.floor(next.value * k);
  };
  const log: LogEntry[] = [];
  let state = adapter.init(seed);
  for (let i = 0; i < attempts; i++) {
    const type = adapter.commandTypes[roll(adapter.commandTypes.length)]!;
    const payload: any = {};
    for (const key of keys) if (roll(2)) payload[key] = junk[roll(junk.length)];
    if (roll(2)) {
      if (type === 'selectExpense') payload.id = `e${1 + roll(4)}`;
      if (type === 'setSplitMode') payload.mode = ['equal', 'percent', 'amount'][roll(3)];
      if (type === 'setSplit') {
        payload.member = ['mina', 'theo', 'ana'][roll(3)];
        payload.value = [0, 2500, 5000, 10000, 8750, 1e8][roll(6)];
      }
      if (type === 'saveResult') {
        payload.requestId = state.pendingSave?.requestId ?? 1;
        payload.ok = roll(2) === 1;
      }
      if (type === 'setView') payload.view = ['receipt', 'balances'][roll(2)];
      if (['attemptResult', 'attemptDue', 'requeue'].includes(type)) {
        const job = state.jobs?.[roll(Math.max(1, state.jobs?.length ?? 1))];
        payload.job = job?.id ?? 'job-1';
        payload.attempt = (job?.attempts.length ?? 0) + 1;
        payload.status = [200, 503, 299, 300, -1][roll(5)];
      }
    }
    const entry: LogEntry = { seq: i + 1, t: i * 10, type, payload, source: 'user' };
    if ((adapter.parse(type, payload) ?? adapter.precondition(state, entry)) !== null) continue;
    state = adapter.apply(state, entry, { t: entry.t });
    log.push(entry);
    if (log.length % 60 === 0) {
      for (const layout of ['wide', 'narrow'] as const) {
        renderToStaticMarkup(createElement(adapter.Render, { state, send: () => {}, interactive: true, layout }));
      }
      canonicalJson(adapter.serialize(state));
    }
  }
  return log;
}

describe('generated sessions', () => {
  for (const adapter of [receiptAdapter, retryAdapter]) {
    it(`${adapter.id}: validation, transcript and seeking agree on every log`, () => {
      let accepted = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const log = generate(adapter, seed, 1500);
        accepted += log.length;
        const project = projectFrom(adapter, 'fuzz', 'Fuzz', log, seed, 16);
        expect(validateProject(adapter, project)).toEqual([]);
        expect(() => buildTranscript(adapter, project)).not.toThrow();
        const check = checkSeeking(adapter, log, seed, 16, seekPositions(log, 16, 60, seed));
        expect(check.mismatches).toEqual([]);
      }
      expect(accepted).toBeGreaterThan(1500);
    });
  }
});

describe('the real controls, in random order', () => {
  it('every snapshot ties its state to its time, and settles on the right state', async () => {
    for (let seed = 1; seed <= 8; seed++) {
      const log = generate(receiptAdapter, seed, 1200);
      const end = log.at(-1)!.t;
      let rng = seed * 7919;
      const roll = (k: number) => {
        const next = nextRandom(rng);
        rng = next.rng;
        return Math.floor(next.value * k);
      };

      const waiting: (() => void)[] = [];
      let frame: ((now: number) => void) | null = null;
      const timeline = new Timeline(receiptAdapter, log, { seed, checkpointEvery: 16 });
      const playback = new Playback(
        timeline,
        { start: 0, end },
        {
          request(run) {
            frame = run;
            return 1;
          },
          cancel() {
            frame = null;
          },
        },
        {
          sliceBudget: 4,
          sliceMs: 0,
          yieldToHost: () => new Promise((resolve) => waiting.push(resolve)),
        },
      );

      const reference = new Timeline(receiptAdapter, log, { seed, checkpointEvery: 16 });
      const check = () => {
        const { state, stateT, count } = playback.getSnapshot();
        expect(count).toBe(reference.countAt(stateT));
        expect(fastHash(receiptAdapter, state)).toBe(fastHash(receiptAdapter, reference.stateAfter(count)));
      };

      let now = 0;
      for (let step = 0; step < 300; step++) {
        const action = roll(6);
        if (action === 0) playback.seek(roll(end + 1));
        else if (action === 1) playback.play();
        else if (action === 2) playback.pause();
        else if (action === 3 && frame !== null) {
          now += roll(40);
          const run: (n: number) => void = frame;
          frame = null;
          run(now);
        } else {
          for (const resume of waiting.splice(0, 1 + roll(3))) resume();
          await Promise.resolve();
          await Promise.resolve();
        }
        check();
      }

      playback.pause();
      const target = roll(end + 1);
      playback.seek(target);
      while (playback.getSnapshot().seeking) {
        for (const resume of waiting.splice(0)) resume();
        await Promise.resolve();
        await Promise.resolve();
      }
      expect(playback.getSnapshot().stateT).toBe(target);
      check();
      playback.destroy();
      for (const resume of waiting.splice(0)) resume();
    }
  }, 60_000);
});
