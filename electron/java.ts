/**
 * Java runtime detection and management.
 *
 * StarMade version requirements:
 *   - Versions >= 0.4.6   require Java 25  (--add-opens + compact object headers)
 *   - Versions >= 0.3     require Java 21  (with --add-opens arg)
 *   - Versions <  0.3     require Java 8   (no extra args)
 *
 * Note two version schemes are in play — the legacy decimal one ("0.203.175",
 * "0.400.307") and the current counter-style one introduced 2026-08 ("0.4.1").
 * See getRequiredJavaVersion.
 *
 * Phase 4 TODO:
 *   - Auto-download Adoptium/Temurin Java 8 and Java 21 to launcher directory
 *   - Store in `jre8/` and `jre21/` subdirectories
 *   - Detect system-installed Java versions as fallback
 *   - Expose IPC: java:detect, java:list, java:download
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Java major versions the launcher knows how to resolve, download and launch. */
export type JavaVersion = 8 | 21 | 25;

/** All supported Java versions, oldest first. */
export const JAVA_VERSIONS: readonly JavaVersion[] = [8, 21, 25];

/**
 * Narrow an untrusted value (e.g. an IPC argument) to a supported Java version.
 * The version is interpolated into a filesystem path and a download URL, so
 * callers crossing a process boundary must validate rather than cast.
 */
export function isJavaVersion(value: unknown): value is JavaVersion {
	return JAVA_VERSIONS.includes(value as JavaVersion);
}

/** JVM arguments required for Java 21 when launching StarMade >= 0.3.x */
export const JAVA_21_ARGS = [
	'-javaagent:StarMade.jar',
	'--add-opens=java.base/jdk.internal.misc=ALL-UNNAMED',
	'--add-opens=java.base/jdk.internal.ref=ALL-UNNAMED',
	'--add-opens=java.base/java.nio=ALL-UNNAMED',
	'--add-opens=java.base/java.lang=ALL-UNNAMED',
	'--add-opens=java.base/java.util=ALL-UNNAMED',
	'--add-opens=java.base/java.io=ALL-UNNAMED',
];

/**
 * JVM arguments for Java 25 (StarMade >= 0.4.6).
 *
 * Same module access as Java 21 plus:
 *   -XX:+UseCompactObjectHeaders   JEP 519, a product (no longer experimental) option in
 *                                 25: 8-byte headers instead of 12, so noticeably less
 *                                 heap and better cache behaviour for the many small
 *                                 objects StarMade creates.
 *
 * No GC flag: G1 (the default) suits client heaps. ZGC only pays off on large
 * dedicated server heaps, where operators can add -XX:+UseZGC via custom JVM args.
 */
export const JAVA_25_ARGS = [
	...JAVA_21_ARGS,
	'-XX:+UseCompactObjectHeaders',
];

/**
 * Additional JVM arguments required on macOS for client (non-server) launches.
 * GLFW/LWJGL3 requires the main thread to be the first thread on macOS.
 */
export const MACOS_CLIENT_ARGS = [
	'-XstartOnFirstThread',
];

/** Java 8 requires no additional JVM arguments. */
export const JAVA_8_ARGS: string[] = [];

// ─── Version detection ────────────────────────────────────────────────────────

/**
 * Determine which Java major version is required for a given StarMade version.
 * @returns 25 for versions >= 0.4.6, 21 for versions >= 0.3.x, otherwise 8.
 */
export function getRequiredJavaVersion(starMadeVersion: string): JavaVersion {
	// Two schemes appear in the build indexes:
	//   legacy — the version is a decimal fraction: "0.17", "0.19624",
	//            "0.203.175", "0.302.101", "0.400.307" (patch appended as a
	//            third component once the minor was zero-padded to 3 digits).
	//   current — since 2026-08 a conventional major.minor.patch counter whose
	//            minor starts at 4: "0.4.0", "0.4.1" (replaced "0.400.307").
	const parts = starMadeVersion.split('.');
	const major = parseInt(parts[0], 10);
	if (parts.length < 2 || isNaN(major)) {
		// Default to Java 8 for unparseable versions (legacy/archive)
		return 8;
	}

	const minorStr = parts[1].trim();
	if (!/^\d+$/.test(minorStr)) return 8;

	// StarMade 1.x and above are well past the 0.4.6 cut-over.
	if (major >= 1) return 25;

	// A 3-component version with a 1- or 2-digit minor can only be the current
	// scheme — the legacy scheme always padded its minor to three digits before
	// it grew a patch component. That scheme began at 0.4, long after the Java
	// 21 cut-over, so every such build needs at least Java 21; 0.4.6 moved to
	// Java 25. (Without this, "0.4.1" reads as the decimal 0.4 < ... and, worse,
	// a future "0.10.0" would read as 0.10 and fall back to Java 8.)
	if (parts.length >= 3 && minorStr.length <= 2) {
		const minor = parseInt(minorStr, 10);
		// A patch like "6-beta" still counts as 6; an unparseable one as 0.
		const patch = parseInt(parts[2], 10) || 0;
		return (minor > 4 || (minor === 4 && patch >= 6)) ? 25 : 21;
	}

	// Legacy scheme: compare as the decimal fraction it is, so
	// 0.19624 < 0.203 < 0.3 <= 0.302 < 0.400. Everything from 0.3 on needs Java 21.
	return parseFloat(`0.${minorStr}`) >= 0.3 ? 21 : 8;
}

/**
 * Get the required JVM arguments for a given Java version.
 */
export function getJvmArgsForJava(javaVersion: JavaVersion): string[] {
	switch (javaVersion) {
		case 25: return JAVA_25_ARGS;
		case 21: return JAVA_21_ARGS;
		default: return JAVA_8_ARGS;
	}
}

// ─── Java download & detection (Phase 4) ─────────────────────────────────────

import fs from 'fs';
import path from 'path';
import https from 'https';
import { execFile } from 'child_process';
import { promisify } from 'util';
import AdmZip from 'adm-zip';
import tar from 'tar-stream';
import { createGunzip } from 'zlib';
import { createHash } from 'crypto';

const execFileAsync = promisify(execFile);

/**
 * Look up the Adoptium release asset for the specified Java version.
 *
 * Uses the assets API rather than the /binary/ redirect endpoint so we get the
 * publisher's SHA-256 alongside the download URL. Both come from the same TLS
 * response, so this does not defend against a compromised Adoptium API — it
 * defends against a tampered or truncated download from the release host it
 * redirects to (GitHub), and against corrupted transfers.
 */
export async function getAdoptiumAsset(version: JavaVersion): Promise<{ link: string; checksum: string }> {
	const platform = process.platform === 'win32' ? 'windows'
		: process.platform === 'darwin' ? 'mac'
			: 'linux';
	// Adoptium has no Java 8 aarch64 build for macOS; use x64 via Rosetta 2.
	const arch = (process.arch === 'arm64' && !(platform === 'mac' && version === 8))
		? 'aarch64' : 'x64';

	const url = `https://api.adoptium.net/v3/assets/latest/${version}/hotspot`
		+ `?os=${platform}&architecture=${arch}&image_type=jre`;

	const res = await fetch(url, { headers: { accept: 'application/json' } });
	if (!res.ok) throw new Error(`Failed to query Adoptium API: HTTP ${res.status}`);

	const assets = await res.json() as Array<{ binary?: { package?: { link?: string; checksum?: string } } }>;
	// `package` is the archive (.zip/.tar.gz); `installer` would be the .msi.
	const pkg = assets?.[0]?.binary?.package;
	if (!pkg?.link || !pkg?.checksum) {
		throw new Error(`Adoptium API returned no JRE package for Java ${version} on ${platform}/${arch}`);
	}
	return { link: pkg.link, checksum: pkg.checksum };
}

/**
 * SHA-256 of a file, lowercase hex.
 */
function sha256File(filePath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = createHash('sha256');
		const stream = fs.createReadStream(filePath);
		stream.on('data', (chunk) => hash.update(chunk));
		stream.on('error', reject);
		stream.on('end', () => resolve(hash.digest('hex')));
	});
}

/**
 * Download a file from a URL to a target path.
 */

/**
 * Hosts the JRE download is allowed to come from, including redirect targets.
 * Adoptium redirects api.adoptium.net -> github.com -> release-assets.githubusercontent.com,
 * and GitHub has renamed that asset host before (objects.githubusercontent.com), so this
 * matches on registrable suffix. If a future rename breaks JRE downloads, add the host here.
 */
const JRE_DOWNLOAD_HOSTS = ['adoptium.net', 'github.com', 'githubusercontent.com'];

const MAX_REDIRECTS = 5;

export function isAllowedDownloadUrl(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== 'https:') return false;
	const host = parsed.hostname.toLowerCase();
	return JRE_DOWNLOAD_HOSTS.some((d) => host === d || host.endsWith('.' + d));
}

function downloadFile(
	url: string,
	targetPath: string,
	onProgress?: (percent: number) => void,
	redirectsLeft: number = MAX_REDIRECTS,
): Promise<void> {
	return new Promise((resolve, reject) => {
		if (!isAllowedDownloadUrl(url)) {
			reject(new Error(`Refusing to download from untrusted URL: ${url}`));
			return;
		}

		const file = fs.createWriteStream(targetPath);
		const fail = (err: Error) => {
			file.close(() => fs.unlink(targetPath, () => {}));
			reject(err);
		};

		https.get(url, (response) => {
			// Handle redirects (301 Moved Permanently, 302 Found, 303 See Other,
			//                    307 Temporary Redirect, 308 Permanent Redirect)
			const status = response.statusCode ?? 0;
			if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) {
				const location = response.headers.location;
				if (!location) {
					fail(new Error(`Redirect (HTTP ${status}) with no location header`));
					return;
				}
				if (redirectsLeft <= 0) {
					fail(new Error(`Too many redirects (>${MAX_REDIRECTS}) downloading ${url}`));
					return;
				}
				response.resume(); // drain so the socket can be reused
				// location may be relative; resolve it against the current URL.
				const next = new URL(location, url).toString();
				file.close(() => {
					fs.unlink(targetPath, () => {
						downloadFile(next, targetPath, onProgress, redirectsLeft - 1).then(resolve).catch(reject);
					});
				});
				return;
			}

			if (status !== 200) {
				response.resume();
				fail(new Error(`Failed to download: HTTP ${response.statusCode}`));
				return;
			}

			const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
			let receivedBytes = 0;

			response.on('data', (chunk) => {
				receivedBytes += chunk.length;
				if (onProgress && totalBytes > 0) {
					onProgress((receivedBytes / totalBytes) * 100);
				}
			});

			response.on('error', fail);
			file.on('error', fail);
			response.pipe(file);

			file.on('finish', () => {
				file.close();
				resolve();
			});
		}).on('error', fail);
	});
}

/**
 * Extract a .tar.gz archive to a target directory.
 */
/**
 * Resolve an archive entry path inside `targetDir`, rejecting anything that escapes it
 * (zip-slip / tar traversal). Returns null if the path is not contained.
 */
export function safeExtractPath(targetDir: string, entryName: string): string | null {
	const root = path.resolve(targetDir);
	const resolved = path.resolve(root, entryName);
	return resolved === root || resolved.startsWith(root + path.sep) ? resolved : null;
}

/**
 * Resolve a link entry's target, rejecting targets that escape `targetDir`.
 * Hard links resolve from the archive root, symlinks from the entry's own
 * directory — but both only need to stay inside `targetDir`, so a JDK's
 * `legal/<module>/X -> ../java.base/X` is fine. Returns null if not contained.
 */
export function safeLinkTarget(
	targetDir: string,
	entryPath: string,
	linkName: string,
	isHardLink: boolean,
): string | null {
	// Reject clearly unsafe link targets from untrusted archives.
	if (!linkName || path.isAbsolute(linkName)) return null;
	const parts = linkName.split(/[\\/]+/);
	if (parts.includes('..')) return null;

	const root = path.resolve(targetDir);
	const base = isHardLink ? root : path.dirname(entryPath);
	const resolved = path.resolve(base, linkName);
	return resolved === root || resolved.startsWith(root + path.sep) ? resolved : null;
}

async function extractTarGz(archivePath: string, targetDir: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const extract = tar.extract();
		const gunzip = createGunzip();
		extract.on('entry', (header, stream, next) => {
			const filePath = safeExtractPath(targetDir, header.name);
			if (!filePath) {
				reject(new Error(`[Java] Refusing to extract entry outside target directory: ${header.name}`));
				return;
			}

			if (header.type === 'directory') {
				fs.mkdirSync(filePath, { recursive: true });
				stream.resume();
				stream.on('end', next);
				stream.on('error', reject);

			} else if (header.type === 'symlink' || header.type === 'link') {
				// JDK archives contain many symlinks; create them instead of writing data.
				// Link targets are attacker-controlled too: a symlink escaping targetDir lets a
				// later entry write through it.
				const isHardLink = header.type === 'link';
				const linkTarget = safeLinkTarget(targetDir, filePath, header.linkname!, isHardLink);
				if (!linkTarget) {
					reject(new Error(`[Java] Refusing to create link outside target directory: ${header.name} -> ${header.linkname}`));
					return;
				}
				fs.mkdirSync(path.dirname(filePath), { recursive: true });
				try {
					if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
					// A hard link's name is relative to the archive root, so it can't be
					// reused as a (directory-relative) symlink target.
					if (isHardLink) fs.linkSync(linkTarget, filePath);
					else fs.symlinkSync(header.linkname!, filePath);
				} catch (err) {
					// Non-fatal: link target may not exist yet in the archive order.
					console.warn(`[Java] Warning: failed to create link ${filePath} -> ${header.linkname}:`, err);
				}
				stream.resume();
				stream.on('end', next);
				stream.on('error', reject);

			} else {
				// Regular file — wait for the WriteStream to *finish* before chmod/next
				// so the file is guaranteed to exist on disk.
				fs.mkdirSync(path.dirname(filePath), { recursive: true });
				const writeStream = fs.createWriteStream(filePath);
				stream.pipe(writeStream);

				writeStream.on('finish', () => {
					if (header.mode && process.platform !== 'win32') {
						try {
							fs.chmodSync(filePath, header.mode);
						} catch (err) {
							console.warn(`[Java] Warning: failed to chmod ${filePath}:`, err);
						}
					}
					next();
				});

				writeStream.on('error', reject);
				stream.on('error', reject);
			}
		});

		extract.on('finish', resolve);
		extract.on('error', reject);
		gunzip.on('error', reject);

		fs.createReadStream(archivePath).pipe(gunzip).pipe(extract);
	});
}

/**
 * Download the specified Java runtime (Adoptium/Temurin) to the launcher's jre8/ or jre21/ directory.
 */
export async function downloadJava(
	version: JavaVersion,
	launcherDir: string,
	onProgress?: (percent: number) => void
): Promise<string> {
	const jreDir = path.join(launcherDir, `jre${version}`);
	const tempFile = path.join(launcherDir, `jre${version}.tmp`);

	console.log(`[Java] Downloading Java ${version} from Adoptium...`);

	try {
		// Download the archive
		const { link, checksum } = await getAdoptiumAsset(version);
		await downloadFile(link, tempFile, onProgress);

		// Verify before extracting — never unpack an archive we haven't authenticated.
		const actual = await sha256File(tempFile);
		if (actual !== checksum.toLowerCase()) {
			throw new Error(`[Java] Checksum mismatch for Java ${version}: expected ${checksum}, got ${actual}`);
		}

		console.log(`[Java] Download verified. Extracting to ${jreDir}...`);

		// Remove existing JRE directory if it exists
		if (fs.existsSync(jreDir)) {
			fs.rmSync(jreDir, { recursive: true, force: true });
		}

		// Create target directory
		fs.mkdirSync(jreDir, { recursive: true });

		// Extract based on platform
		if (process.platform === 'win32') {
			// Windows: .zip
			const zip = new AdmZip(tempFile);
			zip.extractAllTo(jreDir, true);
		} else {
			// macOS/Linux: .tar.gz
			await extractTarGz(tempFile, jreDir);
		}

		// Find the Java executable in the extracted files
		const javaPath = await findJavaExecutable(jreDir);

		// Clean up temp file
		fs.unlinkSync(tempFile);

		console.log(`[Java] Java ${version} installed successfully at ${javaPath}`);
		return javaPath;

	} catch (error) {
		// Clean up on error
		if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
		if (fs.existsSync(jreDir)) fs.rmSync(jreDir, { recursive: true, force: true });
		throw error;
	}
}

/**
 * Recursively find the java/javaw executable in a directory.
 * Throws if not found.
 */
function findJavaExecutable(dir: string): string {
	const javaExe = process.platform === 'win32' ? 'javaw.exe' : 'java';

	function search(currentDir: string): string | null {
		const entries = fs.readdirSync(currentDir, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(currentDir, entry.name);

			if (entry.isDirectory()) {
				const result = search(fullPath);
				if (result) return result;
			} else if (entry.name === javaExe) {
				return fullPath;
			}
		}

		return null;
	}

	const result = search(dir);
	if (!result) {
		throw new Error(`Could not find ${javaExe} in extracted JRE`);
	}

	return result;
}

/**
 * Recursively find the java/javaw executable in a JRE directory.
 * Unlike `findJavaExecutable`, returns null instead of throwing when
 * the executable is not found — safe for use in detection logic.
 *
 * Adoptium/Temurin archives are extracted with a versioned subdirectory
 * inside the target folder (e.g. jre8/jdk8u362-b09-jre/bin/java), so a
 * simple path.join(jreDir, 'bin', 'java') will always miss them.
 */
export function findJavaExecutableInDir(dir: string): string | null {
	try {
		return findJavaExecutable(dir);
	} catch {
		return null;
	}
}

/**
 * Parse Java version from `java -version` output.
 * Returns the major version number (e.g. 8, 11, 17, 21).
 */
export function parseJavaVersion(versionOutput: string): number | null {
	// Example outputs:
	// openjdk version "1.8.0_362"
	// openjdk version "11.0.18"
	// java version "17.0.6"
	// openjdk version "21.0.0"

	const match = versionOutput.match(/version "([^"]+)"/);
	if (!match) return null;

	const versionStr = match[1];
	const parts = versionStr.split('.');

	// Handle 1.8.x format (Java 8)
	if (parts[0] === '1' && parts[1]) {
		return parseInt(parts[1], 10);
	}

	// Handle 11.x, 17.x, 21.x format
	return parseInt(parts[0], 10);
}

/**
 * Parse the JVM bitness (architecture data model) from `java -version` output.
 *
 * The third line of `java -version` describes the VM, e.g.:
 *   64-bit: "OpenJDK 64-Bit Server VM (build 21.0.0+35)"
 *           "Java HotSpot(TM) 64-Bit Server VM ..."
 *   32-bit: "OpenJDK Server VM (build ...)"
 *           "Java HotSpot(TM) Client VM ..."
 *
 * A 32-bit JVM cannot address a heap >= ~4 GB, so `-Xms4096M`/`-Xmx4096M` (or
 * larger) fail with "Invalid initial heap size … exceeds the maximum
 * representable size". We use this to avoid selecting a 32-bit runtime.
 *
 * @returns 64 or 32, or null when the VM line is absent/unrecognized.
 */
export function parseJavaBitness(versionOutput: string): 64 | 32 | null {
	if (!versionOutput) return null;
	// Only classify when we actually saw a VM description line.
	if (!/\bVM\b/i.test(versionOutput)) return null;
	return /64-bit/i.test(versionOutput) ? 64 : 32;
}

/**
 * Pick the executable to run for a `-version` probe.
 *
 * On Windows the launch binary is `javaw.exe` (no console window), but `javaw.exe`
 * does not reliably write `-version` output to a piped stderr — so probing it makes
 * a perfectly good runtime look absent, which in turn triggers a redundant Java
 * download. When the path is a `javaw.exe`, probe the sibling console binary
 * `java.exe` instead (falling back to the given path if `java.exe` is missing). The
 * launch path the caller stores is unchanged — only the probe target differs.
 */
export function versionProbePath(javaPath: string): string {
	if (process.platform !== 'win32') return javaPath;
	if (path.basename(javaPath).toLowerCase() !== 'javaw.exe') return javaPath;
	const consolePath = path.join(path.dirname(javaPath), 'java.exe');
	return fs.existsSync(consolePath) ? consolePath : javaPath;
}

/**
 * Check if a Java executable is valid and return its version and bitness.
 * `arch` is 64 or 32 when it can be determined, otherwise null.
 */
export async function checkJavaExecutable(
	javaPath: string,
): Promise<{ version: number; path: string; arch: 64 | 32 | null } | null> {
	try {
		const { stderr } = await execFileAsync(versionProbePath(javaPath), ['-version']);
		const version = parseJavaVersion(stderr);

		if (version) {
			return { version, path: javaPath, arch: parseJavaBitness(stderr) };
		}
	} catch (error) {
		// Executable doesn't exist or failed to run
	}

	return null;
}

/**
 * Build the list of directories to scan for system-installed Java runtimes.
 *
 * Each entry is treated as a *vendor parent* that holds one versioned JDK/JRE
 * subdirectory per install (e.g. `…\Amazon Corretto\jdk21…`), and is also probed
 * directly in case it is itself a JDK root (e.g. `JAVA_HOME`).
 *
 * Pure and platform-parameterized so it can be unit-tested. Windows roots are
 * derived from environment variables rather than a hardcoded `C:` so non-default
 * drive letters and per-user installs are covered.
 */
export function getSystemJavaSearchPaths(
	env: NodeJS.ProcessEnv,
	platform: NodeJS.Platform,
): string[] {
	const paths: string[] = [];
	const add = (p: string | undefined) => { if (p) paths.push(p); };

	if (platform === 'win32') {
		const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
		const programFilesX86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
		const localAppData = env.LOCALAPPDATA;

		// Common vendor parent directories. Each holds versioned JDK/JRE subfolders.
		const vendorDirs = [
			'Java',                 // Oracle
			'Eclipse Adoptium',     // Temurin (current)
			'Eclipse Foundation',   // Temurin (older)
			'Temurin',
			'Amazon Corretto',
			'Zulu',                 // Azul
			'Microsoft',            // Microsoft Build of OpenJDK (Microsoft\jdk-*)
			'Semeru',               // IBM Semeru
			'IBM',
			'BellSoft\\LibericaJDK',
			'AdoptOpenJDK',         // legacy AdoptOpenJDK
			'RedHat',               // Red Hat build of OpenJDK
		];
		for (const base of [programFiles, programFilesX86]) {
			for (const vendor of vendorDirs) add(path.join(base, vendor));
		}

		// Per-user installs (winget / "install for me only").
		if (localAppData) {
			add(path.join(localAppData, 'Programs', 'Eclipse Adoptium'));
			add(path.join(localAppData, 'Programs', 'Microsoft'));
			add(path.join(localAppData, 'Programs', 'Java'));
			add(path.join(localAppData, 'Eclipse Adoptium'));
		}
	} else if (platform === 'darwin') {
		add('/Library/Java/JavaVirtualMachines');
		add('/System/Library/Java/JavaVirtualMachines');
	} else {
		add('/usr/lib/jvm');
		add('/usr/java');
		add('/opt/java');
		add('/usr/lib64/jvm');
	}

	// JAVA_HOME points directly at a JDK root; it is probed both directly and as a
	// parent (harmless when it has no version subdirs).
	add(env.JAVA_HOME);

	// De-duplicate while preserving order.
	return [...new Set(paths.map(p => path.normalize(p)))];
}

/**
 * Detect system-installed Java runtimes by scanning common install paths.
 */
export async function detectSystemJava(): Promise<Array<{ version: string; path: string; arch: 64 | 32 | null }>> {
	const results: Array<{ version: string; path: string; arch: 64 | 32 | null }> = [];
	const javaExe = process.platform === 'win32' ? 'javaw.exe' : 'java';

	const searchPaths = getSystemJavaSearchPaths(process.env, process.platform);

	// Resolve the bin/<javaExe> path for a given JDK/JRE root directory.
	const binPathFor = (root: string): string =>
		process.platform === 'darwin'
			? path.join(root, 'Contents', 'Home', 'bin', javaExe)
			: path.join(root, 'bin', javaExe);

	const considerRoot = async (root: string): Promise<void> => {
		const result = await checkJavaExecutable(binPathFor(root));
		if (!result) return;
		// StarMade needs a 64-bit JVM (large heaps). A 32-bit Java rejects
		// -Xms/-Xmx >= ~4 GB, so don't offer it.
		if (result.arch === 32) {
			console.log(`[Java] Ignoring 32-bit Java at ${result.path}`);
			return;
		}
		if (!results.some(r => r.path === result.path)) {
			results.push({ version: String(result.version), path: result.path, arch: result.arch });
		}
	};

	// Scan each path: probe it directly (it may itself be a JDK root, e.g. JAVA_HOME)
	// and probe each immediate subdirectory (vendor-parent layout).
	for (const searchPath of searchPaths) {
		if (!fs.existsSync(searchPath)) continue;

		await considerRoot(searchPath);

		try {
			const entries = fs.readdirSync(searchPath, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				await considerRoot(path.join(searchPath, entry.name));
			}
		} catch (error) {
			// Skip directories we can't read
			continue;
		}
	}

	// Also check java in PATH
	try {
		const { stderr } = await execFileAsync('java', ['-version']);
		const version = parseJavaVersion(stderr);
		const arch = parseJavaBitness(stderr);
		if (version && arch !== 32) {
			const { stdout } = await execFileAsync(process.platform === 'win32' ? 'where' : 'which', ['java']);
			const javaPath = stdout.trim().split('\n')[0];

			// Only add if not already in results
			if (!results.some(r => r.path === javaPath)) {
				results.push({ version: String(version), path: javaPath, arch });
			}
		}
	} catch (error) {
		// Java not in PATH
	}

	return results;
}

/**
 * Resolve the Java executable path for the given required version.
 * Priority order:
 *   1. Launcher-bundled JRE (jre8/ or jre21/)
 *   2. System-installed Java matching the required version
 *   3. Returns null if not found (caller should trigger download)
 */
export async function resolveJavaPath(requiredVersion: JavaVersion, launcherDir: string): Promise<string | null> {
	// 1. Check bundled JRE.
	// Adoptium/Temurin archives extract into a versioned subdirectory inside
	// jreDir (e.g. jre8/jdk8u362-b09-jre/bin/java), so we must search
	// recursively rather than assuming jreDir/bin/java exists directly.
	const jreDir = path.join(launcherDir, `jre${requiredVersion}`);

	if (fs.existsSync(jreDir)) {
		const bundledJavaPath = findJavaExecutableInDir(jreDir);
		if (bundledJavaPath) {
			const result = await checkJavaExecutable(bundledJavaPath);
			if (result && result.version === requiredVersion && result.arch !== 32) {
				console.log(`[Java] Using bundled Java ${requiredVersion}: ${bundledJavaPath}`);
				return bundledJavaPath;
			}
			if (result && result.arch === 32) {
				console.warn(`[Java] Bundled Java at ${bundledJavaPath} is 32-bit — ignoring (cannot allocate large heaps)`);
			}
		}
	}

	// 2. Check system Java
	const systemJavas = await detectSystemJava();
	const matchingJava = systemJavas.find(j => parseInt(j.version, 10) === requiredVersion);

	if (matchingJava) {
		console.log(`[Java] Using system Java ${requiredVersion}: ${matchingJava.path}`);
		return matchingJava.path;
	}

	// 3. Not found
	console.log(`[Java] Java ${requiredVersion} not found`);
	return null;
}

/**
 * Resolve a usable Java for `version`, downloading it only if none is available.
 *
 * Resolution order:
 *   1. `preferredPath` (e.g. an installation's stored customJavaPath) when it
 *      exists on disk, is the required major version, and is 64-bit →
 *      `usedPreferred: true`.
 *   2. A bundled or system runtime via `resolveJavaPath()` → `usedPreferred: false`.
 *   3. Download from Adoptium → `downloaded: true`.
 *
 * This mirrors `launchGame()`'s custom-path-then-auto-resolve logic in a single
 * shared place, so the pre-launch "do we need to download?" decision and the launch
 * itself never disagree (which is what caused redundant downloads).
 */
export async function ensureJava(
	version: JavaVersion,
	launcherDir: string,
	opts: { preferredPath?: string } = {},
	// Dependencies are injectable for testing; production callers use the defaults.
	deps: {
		exists?: (p: string) => boolean;
		check?: typeof checkJavaExecutable;
		resolve?: typeof resolveJavaPath;
		download?: typeof downloadJava;
	} = {},
): Promise<{ path: string; downloaded: boolean; usedPreferred: boolean }> {
	const exists = deps.exists ?? fs.existsSync;
	const check = deps.check ?? checkJavaExecutable;
	const resolve = deps.resolve ?? resolveJavaPath;
	const download = deps.download ?? downloadJava;

	const preferred = opts.preferredPath?.trim();
	if (preferred && exists(preferred)) {
		const detected = await check(preferred);
		// arch !== 32 accepts 64-bit and unknown; only a confirmed 32-bit JVM is rejected.
		if (detected && detected.version === version && detected.arch !== 32) {
			return { path: preferred, downloaded: false, usedPreferred: true };
		}
	}

	const resolved = await resolve(version, launcherDir);
	if (resolved) {
		return { path: resolved, downloaded: false, usedPreferred: false };
	}

	const downloaded = await download(version, launcherDir);
	return { path: downloaded, downloaded: true, usedPreferred: false };
}

/**
 * Get the default Java executable paths for jre8, jre21 and jre25 from the launcher
 * directory. These paths may not exist yet if the JREs haven't been downloaded.
 */
export function getDefaultJavaPaths(launcherDir: string): { jre8Path: string; jre21Path: string; jre25Path: string } {
	const exe = process.platform === 'win32' ? 'javaw.exe' : 'java';
	const pathFor = (version: JavaVersion) => path.join(launcherDir, `jre${version}`, 'bin', exe);

	return { jre8Path: pathFor(8), jre21Path: pathFor(21), jre25Path: pathFor(25) };
}

