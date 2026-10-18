/**
 * Fits a desired window geometry inside a display's work area.
 *
 * Exported as a standalone module so the arithmetic can be unit-tested without
 * importing the full Electron main process.
 *
 * Why this exists: BrowserWindow sizes are *device-independent pixels*, so the
 * usable work area shrinks as the OS UI scale grows.  A 1920x1080 Windows
 * desktop reports a ~1536x824 work area at 125% scale and ~1280x690 at 150%,
 * while at 100% it reports ~1920x1040.  Hard-coded defaults that fit at 100%
 * therefore produce a window taller/wider than the screen on a scaled display:
 * Electron centres it, which pushes the frameless title bar (drag region plus
 * minimise/close buttons) off the top edge where the user cannot reach it, and
 * a `minWidth`/`minHeight` larger than the work area means it cannot even be
 * resized back into view.
 *
 * Clamping the size to the work area and the minimums to the clamped size keeps
 * the whole window reachable at any UI scale.  When no position is supplied the
 * window is centred *within the work area* rather than over the full display
 * bounds, so a full-height window is not tucked behind the taskbar.
 */
export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesiredWindowBounds {
  width: number;
  height: number;
  /** Omit to centre in the work area (e.g. a window with no remembered position). */
  x?: number;
  y?: number;
  minWidth: number;
  minHeight: number;
}

export interface FittedWindowBounds {
  width: number;
  height: number;
  x: number;
  y: number;
  minWidth: number;
  minHeight: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

export function fitWindowBounds(desired: DesiredWindowBounds, workArea: WorkArea): FittedWindowBounds {
  const width = Math.min(desired.width, workArea.width);
  const height = Math.min(desired.height, workArea.height);

  return {
    width,
    height,
    x: desired.x === undefined
      ? Math.round(workArea.x + (workArea.width - width) / 2)
      : clamp(desired.x, workArea.x, workArea.x + workArea.width - width),
    y: desired.y === undefined
      ? Math.round(workArea.y + (workArea.height - height) / 2)
      : clamp(desired.y, workArea.y, workArea.y + workArea.height - height),
    // A minimum larger than the window itself would make the window unresizable
    // below a size that does not fit on screen.
    minWidth: Math.min(desired.minWidth, width),
    minHeight: Math.min(desired.minHeight, height),
  };
}
