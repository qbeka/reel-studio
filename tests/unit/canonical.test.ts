import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../src/core/canonical';
import { hashJson, sha256, sha256Text } from '../../src/core/sha256';

describe('canonicalJson', () => {
  it('ignores key order at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [{ y: 1, x: 2 }] } })).toBe(
      canonicalJson({ a: { c: [{ x: 2, y: 1 }], d: 2 }, b: 1 }),
    );
  });

  it('treats -0 and 0 as the same state', () => {
    expect(hashJson({ a: -0 })).toBe(hashJson({ a: 0 }));
  });

  it.each([[{ a: Number.NaN }], [{ a: Number.POSITIVE_INFINITY }], [{ a: undefined }], [{ a: new Map() }], [{ a: () => 1 }]])(
    'refuses a value it cannot carry exactly: %o',
    (value) => {
      expect(() => canonicalJson(value)).toThrow(TypeError);
    },
  );
});

describe('sha256', () => {
  it('matches node:crypto at every padding boundary', () => {
    for (let length = 0; length < 260; length++) {
      const bytes = new Uint8Array(length).map((_, i) => (i * 31 + length) & 0xff);
      expect(sha256(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
    }
  });

  it('matches the FIPS 180-4 vector for "abc"', () => {
    expect(sha256Text('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hashes multi-byte text as UTF-8', () => {
    expect(sha256Text('é€😀')).toBe(createHash('sha256').update('é€😀').digest('hex'));
  });
});
