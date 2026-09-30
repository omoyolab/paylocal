export interface Painter {
  bold: (s: string) => string;
  dim: (s: string) => string;
  red: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  cyan: (s: string) => string;
}

const plain = (s: string): string => s;

export function createPainter(color: boolean): Painter {
  if (!color) {
    return { bold: plain, dim: plain, red: plain, green: plain, yellow: plain, cyan: plain };
  }
  const wrap =
    (code: number, reset = 39) =>
    (s: string) =>
      `\x1b[${code}m${s}\x1b[${reset}m`;
  return {
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    red: wrap(31),
    green: wrap(32),
    yellow: wrap(33),
    cyan: wrap(36),
  };
}

/** Honors NO_COLOR and FORCE_COLOR, then falls back to whether stdout is a TTY. */
export function shouldUseColor(
  env: NodeJS.ProcessEnv = process.env,
  isTTY = process.stdout.isTTY,
): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== "0";
  return Boolean(isTTY);
}

/** Pads `key` so a list of `[key, value]` rows lines up. */
export function table(rows: Array<[string, string]>, indent = "  "): string {
  const width = rows.reduce((max, [key]) => Math.max(max, key.length), 0);
  return rows.map(([key, value]) => `${indent}${key.padEnd(width)}  ${value}`).join("\n");
}

export function truncate(text: string, max = 200): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}
