export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * Returns a deep copy with sorted keys. Two values that mean the same state produce
 * identical text, so their hashes match regardless of the order keys were written in.
 * It throws on anything JSON cannot carry exactly, because a silently dropped field
 * would make two different states hash the same.
 */
export function canonicalize(value: unknown, path = '$'): Json {
  if (value === null) return null;
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return value;
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`${path} is not a finite number`);
      return value === 0 ? 0 : value; // Turns -0 into 0.
    case 'object': {
      if (Array.isArray(value)) return value.map((item, i) => canonicalize(item, `${path}[${i}]`));
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new TypeError(`${path} is not a plain object`);
      }
      const source = value as Record<string, unknown>;
      const out: { [key: string]: Json } = {};
      for (const key of Object.keys(source).sort()) {
        out[key] = canonicalize(source[key], `${path}.${key}`);
      }
      return out;
    }
    default:
      throw new TypeError(`${path} has unsupported type ${typeof value}`);
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
