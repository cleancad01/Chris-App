import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnv, parseEnv } from '../src/main/services/env';

describe('env', () => {
  it('parses', () => {
    expect(parseEnv('# c\n\nA=1\nB="two words"\nC=\'x\'\nexport D=4 # note\nbad line\n')).toEqual({ A: '1', B: 'two words', C: 'x', D: '4' });
  });
  it('loads without overriding', () => {
    const f = path.join(mkdtempSync(path.join(os.tmpdir(), 'env-')), '.env');
    writeFileSync(f, 'TC_TEST_A=file\nTC_TEST_B=file\n');
    process.env.TC_TEST_A = 'existing';
    delete process.env.TC_TEST_B;
    loadEnv([path.join(os.tmpdir(), 'missing.env'), f]);
    expect(process.env.TC_TEST_A).toBe('existing');
    expect(process.env.TC_TEST_B).toBe('file');
  });
});
