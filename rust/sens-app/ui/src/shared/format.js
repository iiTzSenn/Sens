// How the shell writes names, sizes, counts and dates, in Spanish.

export const stem = (path) => path.split(/[/\\]/).filter(Boolean).pop() || path;

export const MARKDOWN = /\.(md|markdown)$/i;

export function compact(count) {
  if (count < 1000) return String(count);
  const kilo = count / 1000;
  const [value, unit] = Math.round(kilo * 10) / 10 >= 1000 ? [kilo / 1000, "M"] : [kilo, "k"];
  return `${value.toLocaleString("es", { maximumFractionDigits: 1 })}${unit}`;
}

export const when = (millis) => new Date(millis).toLocaleString("es", {
  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
});

export const weigh = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString("es", { maximumFractionDigits: 1 })} MB`;
};
