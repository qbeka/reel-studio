import type { AnyAdapter, Command, LogEntry, Payload } from './adapter';
import { compareEntries } from './timeline';

export const FORMAT = 'reel-project';
export const FORMAT_VERSION = 1;

/** Upper bounds on an imported file. They bound memory and load time, not taste. */
export const LIMITS = {
  commands: 100_000,
  chapters: 64,
  captions: 512,
  shots: 512,
  textLength: 400,
  timeMs: 24 * 60 * 60 * 1000,
};

export interface Chapter {
  id: string;
  t: number;
  title: string;
}

export interface Caption {
  id: string;
  start: number;
  end: number;
  text: string;
  /** The target this caption is about. The caption is placed so it does not cover it. */
  target: string | null;
}

/** From `t` until the next shot the camera frames `target`, or the full scene if null. */
export interface CameraShot {
  id: string;
  t: number;
  target: string | null;
}

export interface ReelProject {
  format: typeof FORMAT;
  formatVersion: typeof FORMAT_VERSION;
  id: string;
  title: string;
  disclosure: string;
  scene: { id: string; version: number };
  seed: number;
  checkpointEvery: number;
  trim: { start: number; end: number } | null;
  posterT: number;
  commands: LogEntry[];
  chapters: Chapter[];
  captions: Caption[];
  camera: CameraShot[];
}

export type ParseResult =
  | { ok: true; project: ReelProject }
  | { ok: false; errors: string[] };

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Far above any real log, and low enough that `seq + 1` stays exact in a double. */
const MAX_SEQ = 2 ** 40;

const isTime = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= LIMITS.timeMs;

const isText = (v: unknown): v is string => typeof v === 'string' && v.length <= LIMITS.textLength;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function isPayload(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((v) => isPayload(v, depth + 1));
  return isRecord(value) && Object.values(value).every((v) => isPayload(v, depth + 1));
}

function nullableTarget(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null;
  return typeof v === 'string' && ID.test(v) ? v : undefined;
}

/**
 * Turns untrusted JSON into a project, or lists what is wrong with it.
 *
 * Fields are copied one at a time, so unknown keys, including `__proto__`, never reach a
 * project. Nothing here runs code from the file. Scene code only comes from the registry.
 */
export function parseProject(input: unknown): ParseResult {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ['The file is not a Reel project.'] };
  if (input.format !== FORMAT) {
    return { ok: false, errors: ['The file is not a Reel project.'] };
  }
  if (input.formatVersion !== FORMAT_VERSION) {
    return {
      ok: false,
      errors: [
        `This project uses format version ${String(input.formatVersion)}. This build reads version ${FORMAT_VERSION}.`,
      ],
    };
  }
  const fail = (message: string) => errors.push(message);

  if (typeof input.id !== 'string' || !ID.test(input.id)) fail('The project id is not valid.');
  if (!isText(input.title) || input.title.trim() === '') fail('The project needs a title.');
  if (!isText(input.disclosure)) fail('The disclosure is not valid text.');

  const scene = input.scene;
  if (
    !isRecord(scene) ||
    typeof scene.id !== 'string' ||
    !ID.test(scene.id) ||
    !Number.isInteger(scene.version) ||
    (scene.version as number) < 1
  ) {
    fail('The project does not name a valid scene and version.');
  }
  if (!Number.isInteger(input.seed)) fail('The seed must be a whole number.');
  if (
    !Number.isInteger(input.checkpointEvery) ||
    (input.checkpointEvery as number) < 1 ||
    (input.checkpointEvery as number) > 100_000
  ) {
    fail('checkpointEvery must be a whole number from 1 to 100000.');
  }
  if (!isTime(input.posterT)) fail('posterT must be a time in milliseconds.');

  let trim: ReelProject['trim'] = null;
  if (input.trim !== null) {
    const raw = input.trim;
    if (isRecord(raw) && isTime(raw.start) && isTime(raw.end) && raw.start < raw.end) {
      trim = { start: raw.start, end: raw.end };
    } else {
      fail('The trim range is not valid.');
    }
  }

  const list = (value: unknown, label: string, limit: number): unknown[] => {
    if (!Array.isArray(value)) {
      fail(`${label} must be a list.`);
      return [];
    }
    if (value.length > limit) {
      fail(`${label} has ${value.length} items. The limit is ${limit}.`);
      return [];
    }
    return value;
  };

  const seen = new Set<number>();
  const commands: LogEntry[] = [];
  list(input.commands, 'commands', LIMITS.commands).forEach((raw, i) => {
    if (
      !isRecord(raw) ||
      !Number.isInteger(raw.seq) ||
      (raw.seq as number) < 1 ||
      (raw.seq as number) > MAX_SEQ ||
      !isTime(raw.t) ||
      typeof raw.type !== 'string' ||
      !isRecord(raw.payload) ||
      !isPayload(raw.payload) ||
      (raw.source !== 'user' && raw.source !== 'outcome')
    ) {
      fail(`Command ${i + 1} is not valid.`);
      return;
    }
    if (seen.has(raw.seq as number)) {
      fail(`Command ${i + 1} repeats seq ${String(raw.seq)}.`);
      return;
    }
    seen.add(raw.seq as number);
    commands.push({
      seq: raw.seq as number,
      t: raw.t,
      type: raw.type,
      payload: raw.payload as Payload,
      source: raw.source,
    });
  });
  commands.sort(compareEntries);

  const ids = new Set<string>();
  /** Returns the id when it is valid and unused, otherwise records an error. */
  const claimId = (raw: Record<string, unknown>, label: string): string | null => {
    if (typeof raw.id !== 'string' || !ID.test(raw.id) || ids.has(raw.id)) {
      fail(`${label} has a missing or repeated id.`);
      return null;
    }
    ids.add(raw.id);
    return raw.id;
  };

  const chapters: Chapter[] = [];
  list(input.chapters, 'chapters', LIMITS.chapters).forEach((raw, i) => {
    if (!isRecord(raw) || !isTime(raw.t) || !isText(raw.title) || raw.title.trim() === '') {
      fail(`Chapter ${i + 1} is not valid.`);
      return;
    }
    const id = claimId(raw, `Chapter ${i + 1}`);
    if (id !== null) chapters.push({ id, t: raw.t, title: raw.title });
  });
  chapters.sort((a, b) => a.t - b.t);

  const captions: Caption[] = [];
  list(input.captions, 'captions', LIMITS.captions).forEach((raw, i) => {
    const target = isRecord(raw) ? nullableTarget(raw.target) : undefined;
    if (
      !isRecord(raw) ||
      !isTime(raw.start) ||
      !isTime(raw.end) ||
      raw.end <= raw.start ||
      !isText(raw.text) ||
      target === undefined
    ) {
      fail(`Caption ${i + 1} is not valid.`);
      return;
    }
    const id = claimId(raw, `Caption ${i + 1}`);
    if (id !== null) captions.push({ id, start: raw.start, end: raw.end, text: raw.text, target });
  });
  captions.sort((a, b) => a.start - b.start);

  const camera: CameraShot[] = [];
  list(input.camera, 'camera', LIMITS.shots).forEach((raw, i) => {
    const target = isRecord(raw) ? nullableTarget(raw.target) : undefined;
    if (!isRecord(raw) || !isTime(raw.t) || target === undefined) {
      fail(`Camera shot ${i + 1} is not valid.`);
      return;
    }
    const id = claimId(raw, `Camera shot ${i + 1}`);
    if (id !== null) camera.push({ id, t: raw.t, target });
  });
  camera.sort((a, b) => a.t - b.t);

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    project: {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      id: input.id as string,
      title: input.title as string,
      disclosure: input.disclosure as string,
      scene: { id: (scene as { id: string }).id, version: (scene as { version: number }).version },
      seed: input.seed as number,
      checkpointEvery: input.checkpointEvery as number,
      trim,
      posterT: input.posterT as number,
      commands,
      chapters,
      captions,
      camera,
    },
  };
}

/** The last moment anything happens in the project, in logical milliseconds. */
export function projectEnd(project: ReelProject): number {
  const lastCommand = project.commands.at(-1)?.t ?? 0;
  const lastCaption = project.captions.reduce((end, c) => Math.max(end, c.end), 0);
  return Math.max(lastCommand, lastCaption, ...project.chapters.map((c) => c.t));
}

/**
 * What a viewer receives. Commands before the start stay, because they build the state at
 * the start. Everything after the end goes, so a trim really removes that part of the
 * recording. Tracks outside the range go too, and the poster moves inside it.
 */
export function forViewer(project: ReelProject): ReelProject {
  const { start, end } = playRange(project);
  return {
    ...project,
    trim: project.trim,
    posterT: Math.min(end, Math.max(start, project.posterT)),
    commands: project.commands.filter((c) => c.t <= end),
    chapters: project.chapters.filter((c) => c.t >= start && c.t <= end),
    captions: project.captions.filter((c) => c.end > start && c.start < end),
    camera: project.camera,
  };
}

/** The range a viewer can reach. */
export function playRange(project: ReelProject): { start: number; end: number } {
  return project.trim ?? { start: 0, end: projectEnd(project) };
}

export interface Issue {
  /** The command this issue is about, when it is about one. */
  seq?: number;
  /** The chapter, caption or shot this issue is about, when it is about one. */
  trackId?: string;
  message: string;
}

/**
 * Replays every command with the adapter's own rules. A refused command is reported and
 * skipped, so one early problem shows its full consequences. An empty result means
 * playback cannot reach an impossible command.
 */
export function validateCommands(adapter: AnyAdapter, project: ReelProject): Issue[] {
  const issues: Issue[] = [];
  let state = adapter.init(project.seed);
  for (const entry of project.commands) {
    const known = adapter.commandTypes.includes(entry.type);
    const problem = known
      ? (adapter.parse(entry.type, entry.payload) ?? adapter.precondition(state, entry))
      : `The scene has no command called ${entry.type}.`;
    if (problem !== null) {
      issues.push({ seq: entry.seq, message: `${entry.type} at ${formatTime(entry.t)}: ${problem}` });
      continue;
    }
    state = adapter.apply(state, entry, { t: entry.t });
  }
  return issues;
}

/**
 * The checks that need no replay: known command types and valid payloads. The viewer runs
 * this at load. Whether each command is possible in its state is checked by the replay
 * that also fills the checkpoints, so one pass over the log does both jobs.
 */
export function validateCommandShapes(adapter: AnyAdapter, project: ReelProject): Issue[] {
  const issues: Issue[] = [];
  for (const entry of project.commands) {
    const problem = adapter.commandTypes.includes(entry.type)
      ? adapter.parse(entry.type, entry.payload)
      : `The scene has no command called ${entry.type}.`;
    if (problem !== null) issues.push({ seq: entry.seq, message: `${entry.type}: ${problem}` });
  }
  return issues;
}

export function validateTracks(adapter: AnyAdapter, project: ReelProject): Issue[] {
  const issues: Issue[] = [];
  const known = new Set(adapter.targets.map((t) => t.id));
  const checkTarget = (trackId: string, target: string | null, label: string) => {
    if (target !== null && !known.has(target)) {
      issues.push({ trackId, message: `${label} frames an unknown target, ${target}.` });
    }
  };
  for (const caption of project.captions) checkTarget(caption.id, caption.target, 'A caption');
  for (const shot of project.camera) checkTarget(shot.id, shot.target, 'A camera shot');
  return issues;
}

export function validateProject(adapter: AnyAdapter, project: ReelProject): Issue[] {
  return [...validateCommands(adapter, project), ...validateTracks(adapter, project)];
}

export function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function migrateCommands(
  adapter: AnyAdapter,
  commands: readonly LogEntry[],
  fromVersion: number,
): LogEntry[] {
  if (adapter.migrateCommand === undefined) throw new Error('This scene has no migration.');
  return commands.map((entry) => {
    const migrated: Command = adapter.migrateCommand!(entry, fromVersion);
    return { ...entry, type: migrated.type, payload: migrated.payload };
  });
}
