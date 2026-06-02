import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';

// ─── Mock electron ─────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '4.0.0'),
    getPath: vi.fn((_key: string) => path.join(os.tmpdir(), 'starmade-updater-test')),
  },
  shell: {
    openExternal: vi.fn(() => Promise.resolve()),
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal GitHub release object */
function makeRelease(tag: string, prerelease = false, draft = false) {
  return {
    tag_name: tag,
    prerelease,
    draft,
    body: `Release notes for ${tag}`,
    assets: [] as Array<{ name: string; browser_download_url: string }>,
  };
}

/** Build a release whose assets mirror the real release workflow output. */
function makeReleaseWithAssets(tag: string) {
  const release = makeRelease(tag);
  release.assets = [
    { name: 'StarMade-Launcher.exe',          browser_download_url: 'https://example.com/StarMade-Launcher.exe' },
    { name: 'StarMade-Launcher-macOS-x64.dmg', browser_download_url: 'https://example.com/launcher.dmg' },
    { name: 'StarMade-Launcher.AppImage',      browser_download_url: 'https://example.com/launcher.AppImage' },
    { name: 'app.asar',                        browser_download_url: 'https://example.com/app.asar' },
  ];
  return release;
}

/** Temporarily override process.platform for a test body. */
async function withPlatform<T>(platform: NodeJS.Platform, fn: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    return await fn();
  } finally {
    if (original) Object.defineProperty(process, 'platform', original);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('checkForUpdates', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns available=false when already on the latest stable version', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeRelease('v4.0.0'),
    } as Response);

    const { checkForUpdates } = await import('../../electron/updater.js');
    const result = await checkForUpdates();

    expect(result.available).toBe(false);
    expect(result.latestVersion).toBe('4.0.0');
    expect(result.currentVersion).toBe('4.0.0');
  });

  it('returns available=true when a newer stable release exists', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeRelease('v4.1.0'),
    } as Response);

    const { checkForUpdates } = await import('../../electron/updater.js');
    const result = await checkForUpdates();

    expect(result.available).toBe(true);
    expect(result.latestVersion).toBe('4.1.0');
    expect(result.isPreRelease).toBe(false);
  });

  it('fetches all-releases endpoint when includePreReleases is true', async () => {
    const releases = [
      makeRelease('v4.2.0-beta.1', true),
      makeRelease('v4.1.0', false),
    ];

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => releases,
    } as Response);

    const { checkForUpdates } = await import('../../electron/updater.js');
    const result = await checkForUpdates({ includePreReleases: true });

    // Should pick the first non-draft release (the pre-release)
    expect(result.available).toBe(true);
    expect(result.latestVersion).toBe('4.2.0-beta.1');
    expect(result.isPreRelease).toBe(true);

    // Verify the all-releases endpoint was called
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/releases'),
      expect.any(Object),
    );
    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('/releases/latest');
  });

  it('skips draft releases when includePreReleases is true', async () => {
    const releases = [
      makeRelease('v4.3.0-draft', false, true /* draft */),
      makeRelease('v4.2.0-beta.1', true),
    ];

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => releases,
    } as Response);

    const { checkForUpdates } = await import('../../electron/updater.js');
    const result = await checkForUpdates({ includePreReleases: true });

    // Should skip the draft and pick the pre-release
    expect(result.latestVersion).toBe('4.2.0-beta.1');
    expect(result.isPreRelease).toBe(true);
  });

  it('uses /releases/latest endpoint when includePreReleases is false (default)', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeRelease('v4.1.0'),
    } as Response);

    const { checkForUpdates } = await import('../../electron/updater.js');
    await checkForUpdates({ includePreReleases: false });

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('/releases/latest');
  });

  it('throws when the GitHub API returns a non-OK status', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
    } as Response);

    const { checkForUpdates } = await import('../../electron/updater.js');
    await expect(checkForUpdates()).rejects.toThrow('HTTP 403');
  });

  it('throws when the all-releases response is an empty array', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    const { checkForUpdates } = await import('../../electron/updater.js');
    await expect(checkForUpdates({ includePreReleases: true })).rejects.toThrow();
  });

  it('offers stable release to user on pre-release of same version', async () => {
    // User is on 4.0.0-beta.1, stable 4.0.0 is available
    const { app } = await import('electron');
    vi.mocked(app.getVersion).mockReturnValue('4.0.0-beta.1');

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeRelease('v4.0.0'),
    } as Response);

    const { checkForUpdates } = await import('../../electron/updater.js');
    const result = await checkForUpdates();

    expect(result.available).toBe(true);
    expect(result.latestVersion).toBe('4.0.0');
  });

  it('orders pre-release tags lexicographically', async () => {
    const { app } = await import('electron');
    vi.mocked(app.getVersion).mockReturnValue('4.1.0-alpha.1');

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeRelease('v4.1.0-beta.1'),
    } as Response);

    const { checkForUpdates } = await import('../../electron/updater.js');
    const result = await checkForUpdates();

    expect(result.available).toBe(true);
    expect(result.latestVersion).toBe('4.1.0-beta.1');
  });

  it('does not offer older pre-release when on stable', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [makeRelease('v4.0.0-rc.1', true)],
    } as Response);

    const { checkForUpdates } = await import('../../electron/updater.js');
    const result = await checkForUpdates({ includePreReleases: true });

    // 4.0.0-rc.1 < 4.0.0, so should not be offered
    expect(result.available).toBe(false);
  });

  describe('asset selection by platform', () => {
    it('picks the .exe asset on Windows (portable can\'t use app.asar swap)', async () => {
      await withPlatform('win32', async () => {
        global.fetch = vi.fn().mockResolvedValueOnce({
          ok: true,
          json: async () => makeReleaseWithAssets('v4.1.0'),
        } as Response);

        const { checkForUpdates } = await import('../../electron/updater.js');
        const result = await checkForUpdates();

        expect(result.assetName).toBe('StarMade-Launcher.exe');
        expect(result.assetUrl).toContain('StarMade-Launcher.exe');
      });
    });

    it('prefers app.asar on macOS/Linux for a silent swap', async () => {
      await withPlatform('linux', async () => {
        global.fetch = vi.fn().mockResolvedValueOnce({
          ok: true,
          json: async () => makeReleaseWithAssets('v4.1.0'),
        } as Response);

        const { checkForUpdates } = await import('../../electron/updater.js');
        const result = await checkForUpdates();

        expect(result.assetName).toBe('app.asar');
      });
    });

    it('falls back to the platform installer on macOS/Linux when app.asar is absent', async () => {
      await withPlatform('darwin', async () => {
        const release = makeReleaseWithAssets('v4.1.0');
        release.assets = release.assets.filter((a) => a.name !== 'app.asar');

        global.fetch = vi.fn().mockResolvedValueOnce({
          ok: true,
          json: async () => release,
        } as Response);

        const { checkForUpdates } = await import('../../electron/updater.js');
        const result = await checkForUpdates();

        expect(result.assetName).toBe('StarMade-Launcher-macOS-x64.dmg');
      });
    });
  });
});
