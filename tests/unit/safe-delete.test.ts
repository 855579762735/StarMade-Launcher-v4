import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  isSafeDeletionPath,
  isStarMadeInstallDir,
  STARMADE_MARKERS,
} from '@/electron/safe-delete.ts';

describe('isSafeDeletionPath', () => {
  const home = os.homedir();

  it('blocks the home directory itself', () => {
    expect(isSafeDeletionPath(home)).toBe(false);
  });

  it('blocks well-known user folders (Downloads/Documents/Desktop)', () => {
    expect(isSafeDeletionPath(path.join(home, 'Downloads'))).toBe(false);
    expect(isSafeDeletionPath(path.join(home, 'Documents'))).toBe(false);
    expect(isSafeDeletionPath(path.join(home, 'Desktop'))).toBe(false);
  });

  it('is case-insensitive when matching blocked folders', () => {
    expect(isSafeDeletionPath(path.join(home, 'downloads'))).toBe(false);
  });

  it('blocks relative paths and shallow paths near the filesystem root', () => {
    expect(isSafeDeletionPath('relative/path')).toBe(false);
    expect(isSafeDeletionPath(path.parse(home).root)).toBe(false);
  });

  it('allows a deep install folder that is not a protected location', () => {
    const installDir = path.join(home, 'Games', 'StarMade-Install-1');
    expect(isSafeDeletionPath(installDir)).toBe(true);
  });

  it('blocks a path that is a parent of a protected folder', () => {
    // The home dir is a parent of Downloads — must never be deletable.
    expect(isSafeDeletionPath(home)).toBe(false);
  });

  // OneDrive-redirected folders are a Windows-only concept (derived from the
  // OneDrive env var), so this only applies when running on Windows.
  it.runIf(process.platform === 'win32')('blocks OneDrive-redirected user folders when OneDrive is set', () => {
    const original = process.env.OneDrive;
    const fakeOneDrive = path.join(home, 'OneDrive');
    process.env.OneDrive = fakeOneDrive;
    try {
      expect(isSafeDeletionPath(fakeOneDrive)).toBe(false);
      expect(isSafeDeletionPath(path.join(fakeOneDrive, 'Downloads'))).toBe(false);
    } finally {
      if (original === undefined) delete process.env.OneDrive;
      else process.env.OneDrive = original;
    }
  });
});

describe('isStarMadeInstallDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-install-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('treats an empty directory as deletable', () => {
    expect(isStarMadeInstallDir(tmpDir)).toBe(true);
  });

  it('REJECTS a folder whose only entry is a nested "StarMade" subfolder (the Downloads bug)', () => {
    fs.mkdirSync(path.join(tmpDir, 'StarMade'));
    fs.writeFileSync(path.join(tmpDir, 'tax-return.pdf'), 'private');
    expect(isStarMadeInstallDir(tmpDir)).toBe(false);
  });

  it('accepts a directory containing StarMade.jar', () => {
    fs.writeFileSync(path.join(tmpDir, 'StarMade.jar'), '');
    expect(isStarMadeInstallDir(tmpDir)).toBe(true);
  });

  it('accepts a directory containing version.txt', () => {
    fs.writeFileSync(path.join(tmpDir, 'version.txt'), '0.205.1');
    expect(isStarMadeInstallDir(tmpDir)).toBe(true);
  });

  it('rejects a directory with only unrelated files', () => {
    fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'hello');
    fs.mkdirSync(path.join(tmpDir, 'data'));
    expect(isStarMadeInstallDir(tmpDir)).toBe(false);
  });

  it('returns false for a non-existent directory', () => {
    expect(isStarMadeInstallDir(path.join(tmpDir, 'does-not-exist'))).toBe(false);
  });
});

describe('STARMADE_MARKERS', () => {
  it('no longer includes the generic "StarMade" / "data" / "logs" markers', () => {
    expect(STARMADE_MARKERS.has('StarMade')).toBe(false);
    expect(STARMADE_MARKERS.has('data')).toBe(false);
    expect(STARMADE_MARKERS.has('logs')).toBe(false);
  });

  it('includes the strong install-root markers', () => {
    expect(STARMADE_MARKERS.has('StarMade.jar')).toBe(true);
    expect(STARMADE_MARKERS.has('version.txt')).toBe(true);
  });
});
