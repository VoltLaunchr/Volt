export function parseStrictSemver(version: string): readonly [number, number, number] | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isVersionAtLeast(current: string, minimum: string): boolean {
  const currentParts = parseStrictSemver(current);
  const minimumParts = parseStrictSemver(minimum);
  if (!currentParts || !minimumParts) return false;
  for (let index = 0; index < currentParts.length; index += 1) {
    const currentPart = currentParts[index];
    const minimumPart = minimumParts[index];
    if (currentPart === undefined || minimumPart === undefined) return false;
    if (currentPart > minimumPart) return true;
    if (currentPart < minimumPart) return false;
  }
  return true;
}
