/**
 * Steam launch-environment detection.
 *
 * Steam exports environment variables into processes it launches.  We use these
 * to detect when the launcher is running inside Steam's "Gaming Mode" — the
 * full-screen, controller-first shell used by Big Picture and the Steam Deck.
 *
 * Gaming Mode requires fundamentally different lifecycle/window behaviour from
 * the desktop Steam client (see electron/main.ts), because Steam tracks the
 * launcher process itself as the running game and composites it through
 * gamescope.  Everything that depends on this detection is gated so that the
 * normal desktop / macOS experience is completely unaffected.
 */

/**
 * True when the launcher was started by Steam in Big Picture / Gaming Mode.
 *
 * - `SteamTenfoot` is set by the classic Big Picture ("10-foot") UI.
 * - `SteamGamepadUI` is set by the newer Big Picture / Steam Deck Gaming Mode.
 *
 * We deliberately do NOT key off bare `SteamDeck`, which is also set when the
 * Deck is in *Desktop* mode — there, normal windowed behaviour is correct.
 *
 * The `env` argument is injectable purely to keep this function pure/testable;
 * callers should use the default (`process.env`).
 */
export function isSteamGamingMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SteamTenfoot === '1' || env.SteamGamepadUI === '1';
}

/** Join tokens StarMade puts in its Steam rich-presence `connect` string. */
const STEAM_JOIN_TOKENS = new Set(['+connect', '+steamrelay']);

/**
 * Extracts a Steam friend-join request ("Join Game" / an accepted invite) from
 * the launcher's argv, e.g. `+connect 1.2.3.4:4242 +steamrelay 7656...`.
 * The game resolves these itself (direct first, Steam relay fallback), so they
 * are forwarded verbatim.  Re-split because Steam may pass them as one argument.
 */
export function steamJoinArgs(argv: string[] = process.argv): string[] {
  const tokens = splitTokens(argv);
  const result: string[] = [];
  for (let i = 0; i + 1 < tokens.length; i++) {
    if (STEAM_JOIN_TOKENS.has(tokens[i].toLowerCase())) result.push(tokens[i], tokens[++i]);
  }
  return result;
}

/**
 * The host's game version from a join request (`+version 0.302.101`), used to
 * pick or download the matching installation.  Not forwarded to the game.
 */
export function steamJoinVersion(argv: string[] = process.argv): string | undefined {
  const tokens = splitTokens(argv);
  const i = tokens.findIndex(t => t.toLowerCase() === '+version');
  return i >= 0 && i + 1 < tokens.length ? tokens[i + 1] : undefined;
}

function splitTokens(argv: string[]): string[] {
  return argv.join(' ').split(/\s+/);
}
