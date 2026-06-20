import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Well-known files found at the root of a valid StarMade installation.
 * Used by `isStarMadeInstallDir` to verify a directory before deleting it.
 *
 * NOTE: deliberately strict. Earlier versions also listed `'StarMade'`, `'data'`
 * and `'logs'` here, which meant any unrelated folder that merely *contained* a
 * `StarMade` subfolder (or a generic `data`/`logs` dir) was treated as a deletable
 * installation — that is how a user's Downloads folder could be wiped. Only the
 * install-root markers the legacy scanner relies on remain.
 */
export const STARMADE_MARKERS = new Set([
  'StarMade.jar', // Main game JAR
  'version.txt',  // Version descriptor written by the game/launcher
]);

/**
 * Returns the set of absolute paths that must never be recursively deleted,
 * regardless of any installation record. This is a hard backstop independent of
 * the StarMade-marker check below.
 *
 * Includes system directories AND well-known user folders (the home dir itself
 * and Downloads/Documents/Desktop/etc., including their OneDrive-redirected
 * variants on Windows) so a misconfigured installation record can never target
 * personal data.
 */
function getBlockedPaths(): Set<string> {
  const blocked = new Set<string>();
  const add = (p: string | undefined) => {
    if (p) blocked.add(path.normalize(p));
  };

  const homeDir = os.homedir();
  add(homeDir);

  // Well-known user folders beneath the home directory.
  const userFolders = ['Downloads', 'Documents', 'Desktop', 'Pictures', 'Music', 'Videos'];
  for (const folder of userFolders) add(path.join(homeDir, folder));

  if (process.platform === 'win32') {
    add(process.env.SystemRoot);           // C:\Windows
    add(process.env.ProgramFiles);         // C:\Program Files
    add(process.env['ProgramFiles(x86)']); // C:\Program Files (x86)
    add(path.dirname(homeDir));            // C:\Users

    // OneDrive-redirected user folders (Downloads/Documents/Desktop often live here).
    for (const oneDrive of [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial]) {
      if (!oneDrive) continue;
      add(oneDrive);
      for (const folder of userFolders) add(path.join(oneDrive, folder));
    }
  } else {
    for (const p of [
      '/', '/bin', '/boot', '/dev', '/etc', '/lib', '/lib64',
      '/proc', '/root', '/sbin', '/sys', '/tmp', '/usr', '/var',
      '/home',   // parent of Linux user dirs
      '/Users',  // parent of macOS user dirs
    ]) {
      add(p);
    }
  }

  return blocked;
}

/**
 * Returns true when `targetPath` is safe to recursively delete.
 *
 * Safety checks:
 * - Must be an absolute path with at least 2 directory levels below the
 *   filesystem root (prevents deleting root, drive root, or a top-level system
 *   directory such as /home or C:\Users).
 * - Must not equal, nor be a parent of, any blocked system/user directory
 *   (see `getBlockedPaths`).
 */
export function isSafeDeletionPath(targetPath: string): boolean {
  const normalized = path.normalize(targetPath);

  // Must be absolute.
  if (!path.isAbsolute(normalized)) return false;

  // Require at least two meaningful path components beneath the filesystem root.
  const { root } = path.parse(normalized);
  const relParts = normalized.slice(root.length).split(path.sep).filter(Boolean);
  if (relParts.length < 2) return false;

  const blockedPaths = getBlockedPaths();
  // Drive root (e.g. C:\) is always blocked.
  blockedPaths.add(path.normalize(root));

  const lowerNormalized = normalized.toLowerCase();
  for (const blocked of blockedPaths) {
    const lowerBlocked = blocked.toLowerCase();
    // Block if normalized equals the protected path.
    if (lowerNormalized === lowerBlocked) return false;
    // Block if normalized is a *parent* of a protected path.
    if (lowerBlocked.startsWith(lowerNormalized + path.sep)) return false;
  }

  return true;
}

/**
 * Returns true when `targetPath` appears to be a launcher-managed StarMade
 * installation directory.
 *
 * An empty directory is considered safe to remove (it may have been created just
 * before a download was cancelled or never started).
 *
 * For non-empty directories at least one well-known StarMade install-root marker
 * (`StarMade.jar` or `version.txt`) must be present. This prevents accidental
 * deletion of unrelated directories that happen to share a path with a
 * misconfigured installation record.
 */
export function isStarMadeInstallDir(targetPath: string): boolean {
  let entries: string[];
  try {
    entries = fs.readdirSync(targetPath);
  } catch {
    // If we cannot read the directory (e.g. permissions), be conservative.
    return false;
  }

  // Empty directory – safe to delete (created pre-download or after a cancel).
  if (entries.length === 0) return true;

  // At least one well-known StarMade install-root marker must be present.
  return entries.some(e => STARMADE_MARKERS.has(e));
}
