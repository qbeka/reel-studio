import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../../src/core/adapter';
import { parseProject, validateProject } from '../../src/core/project';
import { Timeline } from '../../src/core/timeline';
import { buildTranscript } from '../../src/core/transcript';
import { receiptAdapter } from '../../src/scenes/receipt/adapter';
import { retryAdapter } from '../../src/scenes/retry-queue/adapter';
import recording from '../../projects/receipt-split-release.reel.json';
import retries from '../../projects/retry-queue.reel.json';

/** What the player draws that was never recorded: which control, and which keys. */
describe('typed values', () => {
  const log = recording.commands as LogEntry[];
  const timeline = new Timeline(receiptAdapter, log, { seed: recording.seed, checkpointEvery: 256 });

  it('are what the field shows once the command has happened', () => {
    log.forEach((command, i) => {
      const before = timeline.stateAfter(i);
      const typed = receiptAdapter.typedOf!(before, command);
      if (command.type !== 'setSplit') {
        expect(typed).toBeNull();
        return;
      }
      const after = timeline.stateAfter(i + 1);
      const value = after.draft!.split.values[command.payload.member as string]!;
      // Percent mode in this recording, and the field writes 5000 basis points as 50.
      expect(typed).toBe(String(value / 100));
    });
  });

  it('follow the mode of the split, since an amount is written with its cents', () => {
    let state = receiptAdapter.init(1);
    state = receiptAdapter.apply(state, { type: 'selectExpense', payload: { id: 'e2' } }, { t: 0 });
    state = receiptAdapter.apply(state, { type: 'setSplitMode', payload: { mode: 'amount' } }, { t: 1 });
    expect(receiptAdapter.typedOf!(state, { type: 'setSplit', payload: { member: 'ana', value: 1250 } })).toBe('12.50');
    state = receiptAdapter.apply(state, { type: 'setSplitMode', payload: { mode: 'percent' } }, { t: 2 });
    expect(receiptAdapter.typedOf!(state, { type: 'setSplit', payload: { member: 'ana', value: 1250 } })).toBe('12.5');
  });

  it('are nothing when no receipt is open', () => {
    expect(receiptAdapter.typedOf!(receiptAdapter.init(1), { type: 'setSplit', payload: { member: 'ana', value: 1 } })).toBeNull();
  });
});

describe('the retry queue story', () => {
  const parsed = parseProject(retries);
  if (!parsed.ok) throw new Error(parsed.errors.join(' '));
  const project = parsed.project;
  const timeline = new Timeline(retryAdapter, project.commands, { seed: project.seed, checkpointEvery: 4 });

  it('is a valid project that every command can play in', () => {
    expect(validateProject(retryAdapter, project)).toEqual([]);
  });

  it('tells the story its chapters name', () => {
    const lines = buildTranscript(retryAdapter, project).flatMap((line) => (line.kind === 'step' ? [line.text] : []));
    expect(lines).toContain('Event 1 failed attempt 4 with 503 and moved to dead letters');
    expect(lines).toContain('Requeued Event 1');
    expect(lines).toContain('The endpoint recovered');
    expect(lines).toContain('Event 1 was delivered on attempt 4');
    expect(lines.at(-1)).toBe('Event 2 was delivered on attempt 1');
  });

  it('names the stepper a policy change pressed, from the state it changed', () => {
    const made = project.commands.filter((command) => command.source === 'user');
    const points = made.map((command) =>
      retryAdapter.pointOf!(command, timeline.stateAfter(project.commands.indexOf(command))),
    );
    expect(points).toEqual(['send', 'attempts:up', 'attempts:up', 'requeue:job-1', 'health:true', 'send']);
  });

  it('cannot name a stepper without that state, and falls back to the policy as a whole', () => {
    const change = project.commands.find((command) => command.type === 'setPolicy')!;
    expect(retryAdapter.pointOf!(change)).toBeNull();
    expect(retryAdapter.targetOf(change)).toBe('policy');
  });

  it('tells lowering from raising, and the delay from the attempts', () => {
    const state = retryAdapter.init(1);
    const policy = { ...state.policy };
    const press = (patch: object) => retryAdapter.pointOf!({ type: 'setPolicy', payload: { ...policy, ...patch } }, state);
    expect(press({ maxAttempts: policy.maxAttempts - 1 })).toBe('attempts:down');
    expect(press({ baseDelayMs: policy.baseDelayMs + 100 })).toBe('delay:up');
    expect(press({ baseDelayMs: policy.baseDelayMs - 100 })).toBe('delay:down');
    expect(press({})).toBeNull();
  });
});
