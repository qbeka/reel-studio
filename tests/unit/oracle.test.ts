import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditReceipt, auditRetry } from '../../bench/audit';
import { receiptLog, retryLog } from '../../bench/fixtures';
import { checkSeeking, seekPositions } from '../../bench/harness';
import { receiptAdapter } from '../../src/scenes/receipt/adapter';
import { retryAdapter } from '../../src/scenes/retry-queue/adapter';
import { fastHashOf, frozen } from './helpers';

describe('oracle independence', () => {
  it('imports nothing from the code it checks', async () => {
    for (const file of await readdir('tests/oracle')) {
      const text = await readFile(join('tests/oracle', file), 'utf8');
      const imports = [...text.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
      expect(imports.filter((path) => !path.startsWith('./')), file).toEqual([]);
    }
  });
});

describe('fixtures', () => {
  it('are reproducible from their seed', () => {
    const options = { commands: 400, expenses: 20, seed: 9 };
    expect(fastHashOf(receiptLog(options))).toBe(fastHashOf(receiptLog(options)));
    expect(fastHashOf(receiptLog(options))).not.toBe(fastHashOf(receiptLog({ ...options, seed: 10 })));
    expect(fastHashOf(retryLog({ commands: 400, seed: 9 }))).toBe(fastHashOf(retryLog({ commands: 400, seed: 9 })));
  });

  it('reach the requested length with equal timestamps and a realistic mix', () => {
    const log = receiptLog({ commands: 2000, expenses: 120, seed: 20 });
    expect(log).toHaveLength(2000);
    const equal = log.filter((e, i) => i > 0 && e.t === log[i - 1]!.t).length;
    expect(equal).toBeGreaterThan(20);
    const types = new Set(log.map((e) => e.type));
    for (const type of ['addReceipt', 'selectExpense', 'setSplit', 'confirmEdit', 'saveResult', 'setView']) {
      expect(types).toContain(type);
    }
  });
});

describe('oracle agreement', () => {
  it('matches the receipt scene after every command of a seeded session', () => {
    expect(auditReceipt(frozen(receiptAdapter), receiptLog({ commands: 2000, expenses: 60, seed: 4 }), 4)).toEqual([]);
  });

  it('matches across seeds', () => {
    for (let seed = 1; seed <= 12; seed++) {
      expect(auditReceipt(receiptAdapter, receiptLog({ commands: 300, expenses: 15, seed }), seed)).toEqual([]);
      expect(auditRetry(retryAdapter, retryLog({ commands: 400, seed }), seed)).toEqual([]);
    }
  });

  it('matches the retry queue after every command', () => {
    expect(auditRetry(frozen(retryAdapter), retryLog({ commands: 3000, seed: 8 }), 8)).toEqual([]);
  });
});

describe('seek correctness', () => {
  it('matches replay at every declared position for both scenes', () => {
    const receipts = receiptLog({ commands: 2000, expenses: 60, seed: 4 });
    const positions = seekPositions(receipts, 32, 300, 1);
    expect(positions.length).toBeGreaterThan(800);
    expect(checkSeeking(frozen(receiptAdapter), receipts, 4, 32, positions).mismatches).toEqual([]);

    const retries = retryLog({ commands: 2000, seed: 5 });
    expect(checkSeeking(frozen(retryAdapter), retries, 5, 32, seekPositions(retries, 32, 300, 2)).mismatches).toEqual([]);
  });
});
