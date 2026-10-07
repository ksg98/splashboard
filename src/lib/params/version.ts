/** Splash version gating: every catalog entry carries the first release that accepts it. */

interface ParsedVersion {
  parts: number[];
  /** "1.2.0rc1", "1.2.0.dev3": sorts before the release. */
  pre: boolean;
}

function parseVersion(version: string): ParsedVersion {
  const parts: number[] = [];
  let pre = false;
  for (const segment of version.trim().replace(/^v/i, '').split('.')) {
    const match = /^(\d+)(.*)$/.exec(segment);
    if (!match) {
      pre = true;
      break;
    }
    parts.push(Number(match[1]));
    if (match[2]) {
      pre = true;
      break;
    }
  }
  return { parts, pre };
}

/** Dotted numeric compare; missing parts are 0 ("1.0" == "1.0.0"). Negative when a < b. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const length = Math.max(pa.parts.length, pb.parts.length);
  for (let i = 0; i < length; i++) {
    const diff = (pa.parts[i] ?? 0) - (pb.parts[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  if (pa.pre !== pb.pre) return pa.pre ? -1 : 1;
  return 0;
}

/** True when `version` is at least `min`. An unknown version (null) is assumed to be new enough. */
export function versionAtLeast(
  version: string | null | undefined,
  min: string | null | undefined,
): boolean {
  if (!min || !version) return true;
  return compareVersions(version, min) >= 0;
}

/** Whether the installed Splash accepts this entry. */
export function isAvailable(
  entry: { min_version: string | null },
  version: string | null | undefined,
): boolean {
  return versionAtLeast(version, entry.min_version);
}

/** Plain-English reason a control is disabled by version, or null when it is available. */
export function unavailableReason(
  entry: { min_version: string | null },
  version: string | null | undefined,
): string | null {
  if (isAvailable(entry, version) || !entry.min_version || !version) return null;
  return `Needs Splash ${entry.min_version} or newer (installed: ${version}).`;
}
