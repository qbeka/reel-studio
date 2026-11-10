import type { AnyAdapter, Field } from './adapter';
import type { Json } from './canonical';

/** One value that is not the same in two states. */
export interface Change {
  id: string;
  label: string;
  /** Null when the value exists only in the later state. */
  before: string | null;
  /** Null when the value exists only in the earlier state. */
  after: string | null;
}

const MAX_TEXT = 48;

function show(value: Json): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

function walk(a: Json | undefined, b: Json | undefined, path: string, out: Change[], limit: number): void {
  if (out.length >= limit) return;
  if (a === b) return;
  const plain = (v: Json | undefined): v is { [key: string]: Json } =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  if (plain(a) && plain(b)) {
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      walk(a[key], b[key], path === '' ? key : `${path}.${key}`, out, limit);
    }
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) walk(a[i], b[i], `${path}[${i}]`, out, limit);
    return;
  }
  if (a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b)) return;
  out.push({
    id: path,
    label: path,
    before: a === undefined ? null : show(a),
    after: b === undefined ? null : show(b),
  });
}

/**
 * Every place two JSON values differ, by path. This is the fallback for a scene that names
 * no fields: it is exact, and reads like the data it is.
 */
export function diffJson(a: Json, b: Json, limit = 200): Change[] {
  const out: Change[] = [];
  walk(a, b, '', out, limit);
  return out;
}

/** The fields whose values differ, in the later state's order, then those that went away. */
export function diffFields(before: readonly Field[], after: readonly Field[]): Change[] {
  const old = new Map(before.map((field) => [field.id, field]));
  const changes: Change[] = [];
  for (const field of after) {
    const was = old.get(field.id);
    old.delete(field.id);
    if (was === undefined) changes.push({ id: field.id, label: field.label, before: null, after: field.value });
    else if (was.value !== field.value) {
      changes.push({ id: field.id, label: field.label, before: was.value, after: field.value });
    }
  }
  for (const gone of old.values()) changes.push({ id: gone.id, label: gone.label, before: gone.value, after: null });
  return changes;
}

/**
 * What differs between two states of one scene. Both are whole states, so this is a
 * comparison of data and can be made between any two moments, or between a moment and a
 * viewer's own copy. Transient presentation is left out, as it is from a state's hash.
 */
export function diffStates(adapter: AnyAdapter, before: unknown, after: unknown): Change[] {
  if (before === after) return [];
  if (adapter.fields !== undefined) return diffFields(adapter.fields(before), adapter.fields(after));
  return diffJson(adapter.serialize(before), adapter.serialize(after));
}
