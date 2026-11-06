import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AnyAdapter } from '../../src/core/adapter';
import { LIMITS, type ReelProject, parseProject, validateProject } from '../../src/core/project';
import { type SceneEntry, resolveScene } from '../../src/core/registry';
import { receiptAdapter } from '../../src/scenes/receipt/adapter';

let base: ReelProject;
beforeAll(async () => {
  const parsed = parseProject(JSON.parse(await readFile('projects/receipt-split.reel.json', 'utf8')));
  if (!parsed.ok) throw new Error(parsed.errors.join(' '));
  base = parsed.project;
});

const change = (patch: Record<string, unknown>) => parseProject({ ...base, ...patch });

describe('parseProject', () => {
  it.each([[null], [3], [[]], ['text'], [{}], [{ format: 'zip' }]])('refuses %o', (input) => {
    expect(parseProject(input).ok).toBe(false);
  });

  it('names a future format version', () => {
    const result = change({ formatVersion: 2 });
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.errors[0]).toMatch(/format version 2/);
  });

  it('sorts commands, keeping equal times in seq order', () => {
    const commands = [
      { seq: 3, t: 5, type: 'a', payload: {}, source: 'user' },
      { seq: 1, t: 5, type: 'b', payload: {}, source: 'user' },
      { seq: 2, t: 1, type: 'c', payload: {}, source: 'user' },
    ];
    const result = change({ commands });
    expect(result.ok && result.project.commands.map((c) => c.seq)).toEqual([2, 1, 3]);
  });

  it.each([
    ['a repeated seq', { commands: [{ seq: 1, t: 1, type: 'a', payload: {}, source: 'user' }, { seq: 1, t: 2, type: 'a', payload: {}, source: 'user' }] }],
    ['a negative time', { commands: [{ seq: 1, t: -1, type: 'a', payload: {}, source: 'user' }] }],
    ['a fractional time', { commands: [{ seq: 1, t: 1.5, type: 'a', payload: {}, source: 'user' }] }],
    ['an unknown source', { commands: [{ seq: 1, t: 1, type: 'a', payload: {}, source: 'pixels' }] }],
    ['a payload that is not an object', { commands: [{ seq: 1, t: 1, type: 'a', payload: 'x', source: 'user' }] }],
    ['a very deep payload', { commands: [{ seq: 1, t: 1, type: 'a', payload: deep(12), source: 'user' }] }],
    ['a backwards caption', { captions: [{ id: 'c', start: 5, end: 4, text: 'x', target: null }] }],
    ['a repeated track id', { chapters: [{ id: 'x', t: 0, title: 'a' }, { id: 'x', t: 1, title: 'b' }] }],
    ['a bad scene', { scene: { id: '../evil', version: 1 } }],
    ['a zero checkpoint interval', { checkpointEvery: 0 }],
    ['a backwards trim', { trim: { start: 10, end: 5 } }],
    ['too many commands', { commands: new Array(LIMITS.commands + 1).fill(0) }],
  ])('refuses %s', (_name, patch) => {
    expect(change(patch).ok).toBe(false);
  });

  it('drops keys it does not know, including prototype keys', () => {
    const text = JSON.stringify({ ...base, script: 'alert(1)' }).replace(
      '"format":',
      '"__proto__":{"polluted":true},"format":',
    );
    const result = parseProject(JSON.parse(text));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect('script' in result.project).toBe(false);
      expect(Object.getPrototypeOf(result.project)).toBe(Object.prototype);
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    }
  });
});

function deep(levels: number): Record<string, unknown> {
  return levels === 0 ? { x: 1 } : { x: deep(levels - 1) };
}

describe('validateProject', () => {
  it('flags a command type the scene does not have', () => {
    const issues = validateProject(receiptAdapter, {
      ...base,
      commands: [{ seq: 1, t: 1, type: 'wireMoney', payload: {}, source: 'user' }],
    });
    expect(issues[0]?.message).toMatch(/no command called wireMoney/);
  });

  it('reports the full consequence of a missing command', () => {
    const issues = validateProject(receiptAdapter, { ...base, commands: base.commands.slice(1) });
    expect(issues.length).toBeGreaterThan(3);
    expect(issues[0]?.message).toMatch(/No receipt is open/);
  });

  it('flags a shot on a target the scene does not declare', () => {
    const issues = validateProject(receiptAdapter, {
      ...base,
      camera: [{ id: 's', t: 0, target: 'ghost' }],
    });
    expect(issues[0]?.message).toMatch(/unknown target, ghost/);
  });
});

describe('resolveScene', () => {
  const installed = (adapter: AnyAdapter, version = adapter.version): SceneEntry[] => [
    { id: adapter.id, version, title: adapter.title, load: async () => adapter },
  ];

  it('resolves an exact match', async () => {
    const result = await resolveScene(base, installed(receiptAdapter));
    expect(result).toMatchObject({ ok: true, adapter: receiptAdapter });
  });

  it('names the scene and what is installed when it is unknown', async () => {
    const result = await resolveScene({ ...base, scene: { id: 'payroll', version: 3 } }, installed(receiptAdapter));
    expect(result).toMatchObject({ ok: false, code: 'unknown-scene' });
    expect(!result.ok && result.message).toBe(
      'This project needs the scene payroll v3, which is not installed. Installed scenes: receipt-split v1.',
    );
  });

  it('refuses a project from a newer scene', async () => {
    const result = await resolveScene({ ...base, scene: { id: 'receipt-split', version: 9 } }, installed(receiptAdapter));
    expect(result).toMatchObject({ ok: false, code: 'newer-version' });
  });

  it('refuses an older project when no migration exists', async () => {
    const newer: AnyAdapter = { ...receiptAdapter, version: 2 };
    const result = await resolveScene(base, installed(newer));
    expect(result).toMatchObject({ ok: false, code: 'no-migration' });
  });

  it('migrates an older project and replays it to the same result', async () => {
    // A test adapter whose v2 renamed the `value` field of setSplit to `share`.
    const v2: AnyAdapter = {
      ...receiptAdapter,
      version: 2,
      parse: (type, payload) =>
        receiptAdapter.parse(type, type === 'setSplit' ? { member: payload.member!, value: payload.share! } : payload),
      precondition: (state, c) => receiptAdapter.precondition(state, c),
      apply: (state, c, clock) =>
        receiptAdapter.apply(
          state,
          c.type === 'setSplit' ? { ...c, payload: { member: c.payload.member!, value: c.payload.share! } } : c,
          clock,
        ),
      migrateCommand(command) {
        if (command.type !== 'setSplit') return command;
        const { value, ...rest } = command.payload;
        return { ...command, payload: { ...rest, share: value! } };
      },
    };
    const result = await resolveScene(base, installed(v2));
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.project.scene.version).toBe(2);
      expect(validateProject(v2, result.project)).toEqual([]);
      const edit = result.project.commands.find((c) => c.type === 'setSplit');
      expect(edit?.payload).toHaveProperty('share');
      expect(edit?.payload).not.toHaveProperty('value');
      // The input must not change.
      expect(base.commands.find((c) => c.type === 'setSplit')?.payload).toHaveProperty('value');
    }
  });
});
