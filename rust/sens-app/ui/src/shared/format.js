// How the shell writes names, sizes, counts and dates, in Spanish.

export const stem = (path) => path.split(/[/\\]/).filter(Boolean).pop() || path;

export const MARKDOWN = /\.(md|markdown)$/i;
export const TEXTUAL = /\.(md|markdown|txt|json|csv|log|js|mjs|cjs|ts|tsx|jsx|rs|py|rb|go|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|ps1|bat|toml|ya?ml|xml|css|scss|sql|lua|vue|svelte|ini|diff|patch)$/i;
export const PAGE = /\.html?$/i;
export const PICTURE = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i;

export function compact(count) {
  if (count < 1000) return String(count);
  const kilo = count / 1000;
  const [value, unit] = Math.round(kilo * 10) / 10 >= 1000 ? [kilo / 1000, "M"] : [kilo, "k"];
  return `${value.toLocaleString("es", { maximumFractionDigits: 1 })}${unit}`;
}

export const when = (millis) => new Date(millis).toLocaleString("es", {
  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
});

const dayOf = (offset) => {
  const day = new Date();
  day.setDate(day.getDate() - offset);
  return day.toDateString();
};

// The time today, "ayer", or the day and month.
export function ago(millis) {
  const at = new Date(millis);
  if (at.toDateString() === dayOf(0)) return at.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  if (at.toDateString() === dayOf(1)) return "ayer";
  return at.toLocaleDateString("es", { day: "numeric", month: "short" }).replace(/\./g, "");
}

export const weigh = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString("es", { maximumFractionDigits: 1 })} MB`;
};
