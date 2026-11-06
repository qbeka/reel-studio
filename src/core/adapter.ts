import type { ComponentType } from 'react';
import type { Json } from './canonical';

/** Payload of a command. Always a plain JSON object. */
export type Payload = { [key: string]: Json };

/** A semantic command, before it has a place in a log. */
export interface Command {
  type: string;
  payload: Payload;
}

/** A command with its place in a recording. See docs/FORMAT.md for ordering. */
export interface LogEntry extends Command {
  /** Unique within a recording. Breaks ties between equal timestamps. */
  seq: number;
  /** Logical milliseconds since the start of the recording. */
  t: number;
  /** `user` came from the scene's controls, `outcome` from a delayed effect. */
  source: 'user' | 'outcome';
}

/** Logical time handed to `apply`. Scenes must not read any other clock. */
export interface LogicalClock {
  t: number;
}

/** An outcome the local fixture service will report after `delayMs`. */
export interface Effect {
  delayMs: number;
  command: Command;
}

export interface Size {
  width: number;
  height: number;
}

export type LayoutName = 'wide' | 'narrow';

export interface TargetDefinition {
  id: string;
  label: string;
}

export interface SceneProps<S> {
  state: S;
  send: (type: string, payload?: Payload) => void;
  /** False during playback. The stage also marks the scene inert. */
  interactive: boolean;
  layout: LayoutName;
}

export interface SceneAdapter<S> {
  id: string;
  version: number;
  title: string;
  summary: string;
  commandTypes: readonly string[];
  targets: readonly TargetDefinition[];
  /** Each layout is its own stable coordinate system for target bounds. */
  layouts: Record<LayoutName, Size>;

  init(seed: number): S;
  /** Validates payload shape, independent of state. Returns an error message or null. */
  parse(type: string, payload: Payload): string | null;
  /** Explains why a command is impossible in this state, or returns null. */
  precondition(state: S, command: Command): string | null;
  /** Pure transition. Must return a new state and leave `state` untouched. */
  apply(state: S, command: Command, clock: LogicalClock): S;
  /**
   * Outcomes for a local fixture service. `state` is the state after `command` applied.
   * Called only live, never during playback.
   */
  effects?(state: S, command: Command): readonly Effect[];
  /**
   * Outcomes still owed by a state at logical time `t`. A live session can start from a
   * state that is waiting for one, such as a fork during a save, and the timer that would
   * have delivered it belonged to the recording. Required with `effects`.
   */
  pendingEffects?(state: S, t: number): readonly Effect[];

  /** Canonical data for hashing and storage. Excludes presentation fields. */
  serialize(state: S): Json;
  /** Rebuilds state from `serialize` output written by adapter `fromVersion`. */
  restore(json: Json, fromVersion: number): S;
  /** Rewrites a command recorded by an older adapter version. */
  migrateCommand?(command: Command, fromVersion: number): Command;

  /** One plain line for the transcript, or null when the step is not worth a line. */
  describe(before: S, command: Command, after: S): string | null;
  /** The named target a command acts on, or null. */
  targetOf(command: Command): string | null;

  Render: ComponentType<SceneProps<S>>;
}

/**
 * The registry and player handle adapters of many state types. `S` only flows between an
 * adapter's own methods, so erasing it here is safe. This is the one place that does so.
 */
export type AnyAdapter = SceneAdapter<any>;
