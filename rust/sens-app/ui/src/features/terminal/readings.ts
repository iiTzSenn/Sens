const KEPT = 24;
const readings = new Map<string, string>();

export function keepReading(plain: string, colored: string) {
  readings.delete(plain);
  if (plain === colored) return;
  readings.set(plain, colored);
  if (readings.size > KEPT) readings.delete(readings.keys().next().value!);
}

export const readingOf = (plain: string) => readings.get(plain) ?? readings.get(plain.trimEnd()) ?? null;
