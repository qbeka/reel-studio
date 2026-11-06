import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  HISTORY_LIMIT,
  appendCommands,
  commit,
  initialHistory,
  newTrackId,
  nextSeq,
  proposeEdit,
  redo,
  removeCommands,
  retimeCommand,
  setCommandPayload,
  undo,
  withoutBroken,
} from '../../src/core/edit';
import { type ReelProject, parseProject, validateCommands } from '../../src/core/project';
import { receiptAdapter } from '../../src/scenes/receipt/adapter';

let base: ReelProject;
beforeAll(async () => {
  const parsed = parseProject(JSON.parse(await readFile('projects/receipt-split.reel.json', 'utf8')));
  if (!parsed.ok) throw new Error(parsed.errors.join(' '));
  base = parsed.project;
});

const seqOf = (type: string, index = 0) =>
  base.commands.filter((c) => c.type === type)[index]!.seq;

describe('editing commands', () => {
  it('allows removing a command nothing depends on', () => {
    const proposal = proposeEdit(receiptAdapter, removeCommands(base, new Set([seqOf('setView')])));
    expect(proposal.broken).toEqual([]);
  });

  it('reports everything that depends on a removed command', () => {
    const proposal = proposeEdit(receiptAdapter, removeCommands(base, new Set([seqOf('selectExpense')])));
    expect(proposal.broken.length).toBe(base.commands.length - 2);
    expect(proposal.broken[0]?.message).toMatch(/No receipt is open/);
  });

  it('repairs a broken edit into a recording that can play', () => {
    const proposal = proposeEdit(receiptAdapter, removeCommands(base, new Set([seqOf('selectExpense')])));
    const repaired = withoutBroken(receiptAdapter, proposal);
    expect(repaired.broken).toEqual([]);
    expect(validateCommands(receiptAdapter, repaired.project)).toEqual([]);
    expect(repaired.project.commands.map((c) => c.type)).toEqual(['setView']);
  });

  it('removes an outcome safely but flags a save with no outcome only if a later edit needs it', () => {
    const outcome = base.commands.findLast((c) => c.type === 'saveResult')!;
    const proposal = proposeEdit(receiptAdapter, removeCommands(base, new Set([outcome.seq])));
    // setView is allowed during a save, so this recording stays playable. The save simply
    // never finishes, which the author can see in the preview.
    expect(proposal.broken).toEqual([]);
  });

  it('catches an outcome moved before its cause', () => {
    const outcome = base.commands.find((c) => c.type === 'saveResult')!;
    const proposal = proposeEdit(receiptAdapter, retimeCommand(base, outcome.seq, 1));
    expect(proposal.broken.some((issue) => issue.seq === outcome.seq)).toBe(true);
  });

  it('keeps the log sorted after a retime', () => {
    const moved = retimeCommand(base, seqOf('setSplitMode'), 0);
    expect(moved.commands[0]?.type).toBe('setSplitMode');
    const times = moved.commands.map((c) => c.t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('catches a payload edit that a later command cannot follow', () => {
    const proposal = proposeEdit(
      receiptAdapter,
      setCommandPayload(base, seqOf('setSplitMode'), { mode: 'equal' }),
    );
    expect(proposal.broken.length).toBeGreaterThan(0);
    expect(proposal.broken[0]?.message).toMatch(/equal split has no shares/);
  });

  it('does not change the original project', () => {
    const before = JSON.stringify(base);
    removeCommands(base, new Set([seqOf('selectExpense')]));
    retimeCommand(base, seqOf('setSplit'), 1);
    setCommandPayload(base, seqOf('setView'), {});
    appendCommands(base, []);
    expect(JSON.stringify(base)).toBe(before);
  });

  it('gives new commands a seq after every existing one, and sorted equal times stay stable', () => {
    const seq = nextSeq(base);
    expect(seq).toBeGreaterThan(Math.max(...base.commands.map((c) => c.seq)));
    const t = base.commands[0]!.t;
    const appended = appendCommands(base, [
      { seq, t, type: 'setView', payload: { view: 'receipt' }, source: 'user' },
    ]);
    const atT = appended.commands.filter((c) => c.t === t).map((c) => c.seq);
    expect(atT).toEqual([base.commands[0]!.seq, seq]);
  });

  it('never reuses a track id', () => {
    const project = { ...base, chapters: [{ id: 'chapter-1', t: 0, title: 'x' }], captions: [{ id: 'chapter-2', start: 0, end: 1, text: 'x', target: null }] };
    expect(newTrackId(project, 'chapter')).toBe('chapter-3');
  });
});

describe('undo history', () => {
  it('moves back and forward and clears redo on a new edit', () => {
    let h = initialHistory(1);
    h = commit(h, 2);
    h = commit(h, 3);
    h = undo(h);
    expect(h.present).toBe(2);
    h = redo(h);
    expect(h.present).toBe(3);
    h = undo(undo(h));
    expect(h.present).toBe(1);
    h = commit(h, 9);
    expect(h.future).toEqual([]);
    expect(redo(h)).toBe(h);
  });

  it('does nothing at either end', () => {
    const h = initialHistory(1);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
    expect(commit(h, 1)).toBe(h);
  });

  it('keeps a bounded number of steps', () => {
    let h = initialHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 50; i++) h = commit(h, i);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.present).toBe(HISTORY_LIMIT + 50);
  });
});
