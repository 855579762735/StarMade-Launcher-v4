import { describe, it, expect } from 'vitest';
import { isRunningAsAppImage } from '../../electron/appimage-detect.js';
import { isRunningOnWayland } from '../../electron/wayland-detect.js';
import { parseVersionTxt } from '../../electron/legacy.js';
import { fitWindowBounds } from '../../electron/window-bounds.js';

// ─── isRunningAsAppImage ──────────────────────────────────────────────────────

describe('isRunningAsAppImage', () => {
  it('returns true when APPIMAGE env var is set', () => {
    expect(isRunningAsAppImage({ APPIMAGE: '/mnt/drive/StarMadeLauncher.AppImage' }, '/usr/bin/app')).toBe(true);
  });

  it('returns true when APPDIR env var is set', () => {
    expect(isRunningAsAppImage({ APPDIR: '/tmp/.mount_StarMaEbqYcJ' }, '/usr/bin/app')).toBe(true);
  });

  it('returns true when exe path contains /.mount_ (squashfs mount)', () => {
    expect(isRunningAsAppImage({}, '/tmp/.mount_StarMaEbqYcJ/starmade-launcher')).toBe(true);
  });

  it('returns true for a deeper squashfs-mounted exe path', () => {
    expect(isRunningAsAppImage({}, '/tmp/.mount_AbCdEfGhIj/opt/StarMadeLauncher/starmade-launcher')).toBe(true);
  });

  it('returns false when none of the AppImage indicators are present', () => {
    expect(isRunningAsAppImage({}, '/usr/lib/starmade-launcher/starmade-launcher')).toBe(false);
  });

  it('returns false for a deb/rpm-installed binary path', () => {
    expect(isRunningAsAppImage({}, '/opt/StarMadeLauncher/starmade-launcher')).toBe(false);
  });

  it('returns true when all three indicators are present', () => {
    expect(isRunningAsAppImage(
      { APPIMAGE: '/mnt/drive/StarMadeLauncher.AppImage', APPDIR: '/tmp/.mount_StarMaEbqYcJ' },
      '/tmp/.mount_StarMaEbqYcJ/starmade-launcher',
    )).toBe(true);
  });

  it('returns false when APPIMAGE env var is an empty string', () => {
    expect(isRunningAsAppImage({ APPIMAGE: '' }, '/usr/lib/starmade-launcher/starmade-launcher')).toBe(false);
  });

  it('returns false when APPDIR env var is an empty string', () => {
    expect(isRunningAsAppImage({ APPDIR: '' }, '/usr/lib/starmade-launcher/starmade-launcher')).toBe(false);
  });
});

// ─── isRunningOnWayland ───────────────────────────────────────────────────────

describe('isRunningOnWayland', () => {
  it('returns true when WAYLAND_DISPLAY is set', () => {
    expect(isRunningOnWayland({ WAYLAND_DISPLAY: 'wayland-0' })).toBe(true);
  });

  it('returns true when XDG_SESSION_TYPE is "wayland"', () => {
    expect(isRunningOnWayland({ XDG_SESSION_TYPE: 'wayland' })).toBe(true);
  });

  it('returns true when both WAYLAND_DISPLAY and XDG_SESSION_TYPE=wayland are set', () => {
    expect(isRunningOnWayland({ WAYLAND_DISPLAY: 'wayland-0', XDG_SESSION_TYPE: 'wayland' })).toBe(true);
  });

  it('returns false when only XDG_SESSION_TYPE=x11 is set', () => {
    expect(isRunningOnWayland({ XDG_SESSION_TYPE: 'x11' })).toBe(false);
  });

  it('returns false when no Wayland indicators are present', () => {
    expect(isRunningOnWayland({})).toBe(false);
  });

  it('returns false when WAYLAND_DISPLAY is an empty string', () => {
    expect(isRunningOnWayland({ WAYLAND_DISPLAY: '' })).toBe(false);
  });

  it('returns true when WAYLAND_DISPLAY is set even if XDG_SESSION_TYPE is x11', () => {
    // WAYLAND_DISPLAY being set is the authoritative indicator
    expect(isRunningOnWayland({ WAYLAND_DISPLAY: 'wayland-1', XDG_SESSION_TYPE: 'x11' })).toBe(true);
  });
});

// ─── parseVersionTxt ─────────────────────────────────────────────────────────

describe('parseVersionTxt', () => {
  it('parses a standard version.txt entry', () => {
    expect(parseVersionTxt('0.205.1#20260311_181557')).toBe('0.205.1');
  });

  it('handles trailing newline', () => {
    expect(parseVersionTxt('0.205.1#20260311_181557\n')).toBe('0.205.1');
  });

  it('handles Windows-style line endings', () => {
    expect(parseVersionTxt('0.203.175#20231020_123456\r\n')).toBe('0.203.175');
  });

  it('returns null when there is no # character', () => {
    expect(parseVersionTxt('0.205.1')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseVersionTxt('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(parseVersionTxt('   \n')).toBeNull();
  });

  it('returns null when version part is empty (# at start)', () => {
    expect(parseVersionTxt('#20260311_181557')).toBeNull();
  });

  it('returns null when version part is only whitespace', () => {
    expect(parseVersionTxt('   #20260311_181557')).toBeNull();
  });
});


// ─── fitWindowBounds ──────────────────────────────────────────────────────────

describe('fitWindowBounds', () => {
  // Work areas a 1920x1080 Windows desktop reports at the common UI scales.
  const scale100 = { x: 0, y: 0, width: 1920, height: 1040 };
  const scale125 = { x: 0, y: 0, width: 1536, height: 824 };
  const scale150 = { x: 0, y: 0, width: 1280, height: 690 };
  const mainWindow = { width: 1460, height: 1024, minWidth: 1024, minHeight: 600 };

  it('keeps the requested size when it fits (100% scale)', () => {
    expect(fitWindowBounds(mainWindow, scale100)).toEqual({
      width: 1460, height: 1024, x: 230, y: 8, minWidth: 1024, minHeight: 600,
    });
  });

  it('shrinks a too-tall window to the work area at 125% scale', () => {
    const fitted = fitWindowBounds(mainWindow, scale125);
    expect(fitted.height).toBe(824);
    expect(fitted.width).toBe(1460);
    // Title bar must stay on screen — this is what broke at non-100% scale.
    expect(fitted.y).toBe(0);
  });

  it('shrinks both axes and the minimums at 150% scale', () => {
    expect(fitWindowBounds(mainWindow, scale150)).toEqual({
      width: 1280, height: 690, x: 0, y: 0, minWidth: 1024, minHeight: 600,
    });
  });

  it('never leaves a minimum larger than the window', () => {
    const fitted = fitWindowBounds(
      { width: 1440, height: 980, minWidth: 1100, minHeight: 720 },
      scale150,
    );
    expect(fitted.minWidth).toBeLessThanOrEqual(fitted.width);
    expect(fitted.minHeight).toBeLessThanOrEqual(fitted.height);
  });

  it('pulls remembered bounds back inside the work area', () => {
    const fitted = fitWindowBounds(
      { width: 1440, height: 980, x: 1200, y: 900, minWidth: 1100, minHeight: 720 },
      scale125,
    );
    expect(fitted.x + fitted.width).toBeLessThanOrEqual(scale125.width);
    expect(fitted.y + fitted.height).toBeLessThanOrEqual(scale125.height);
    expect(fitted.x).toBeGreaterThanOrEqual(0);
    expect(fitted.y).toBeGreaterThanOrEqual(0);
  });

  it('honours a work-area offset (taskbar / secondary display)', () => {
    const secondary = { x: 1920, y: 40, width: 1280, height: 690 };
    const fitted = fitWindowBounds(mainWindow, secondary);
    expect(fitted.x).toBe(1920);
    expect(fitted.y).toBe(40);
  });

  it('clamps a remembered position that sits before the work-area origin', () => {
    const fitted = fitWindowBounds(
      { width: 1200, height: 600, x: -500, y: -200, minWidth: 1024, minHeight: 600 },
      { x: 0, y: 40, width: 1536, height: 824 },
    );
    expect(fitted.x).toBe(0);
    expect(fitted.y).toBe(40);
  });
});
