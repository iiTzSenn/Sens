export function createDebouncedSearch({ search, changed, delay }) {
  let revision = 0;
  let timer;
  let hits = [];

  return {
    schedule(query, enabled = true) {
      const current = ++revision;
      clearTimeout(timer);
      const pending = enabled && query.length >= 2;
      if (!pending) hits = [];
      changed({ pending, hits, error: "" });
      if (!pending) return;

      timer = setTimeout(async () => {
        try {
          const found = await search(query);
          if (current !== revision) return;
          hits = found;
          changed({ pending: false, hits, error: "" });
        } catch (reason) {
          if (current === revision) changed({ pending: false, hits, error: String(reason) });
        }
      }, delay);
    },
  };
}

export const plain = (text) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const TRUST = { anthropic: 6, partner: 4, community: 0, skillsSh: 0 };

const startsWord = (text, part) => {
  for (let at = text.indexOf(part); at >= 0; at = text.indexOf(part, at + 1)) {
    if (at === 0 || !/[\p{L}\p{N}]/u.test(text[at - 1])) return true;
  }
  return false;
};

function fitOf(words, part) {
  if (words.names.includes(part)) return 100;
  if (words.names.some((name) => name.startsWith(part))) return 80;
  if (words.names.some((name) => startsWord(name, part))) return 60;
  if (words.names.some((name) => name.includes(part))) return 40;
  if (startsWord(words.rest, part)) return 15;
  return words.rest.includes(part) ? 8 : 0;
}

export function createMarketRanker() {
  const cached = new WeakMap();
  const wordsOf = (listing) => {
    let words = cached.get(listing);
    if (!words) {
      const names = [plain(listing.name || ""), plain(listing.title || "")];
      words = {
        names: [...names, ...names.map((name) => name.replace(/[-_]+/g, " "))],
        rest: plain([listing.description, listing.author, listing.category].filter(Boolean).join("\n")),
        lift: (TRUST[listing.badge] || 0) + (listing.installable ? 6 : 0) + Math.min(6, 1.2 * Math.log10((listing.installs || 0) + 1)),
      };
      cached.set(listing, words);
    }
    return words;
  };
  return (list, needle) => {
    const parts = needle.split(/\s+/).filter(Boolean);
    const scored = [];
    list.forEach((listing, at) => {
      const words = wordsOf(listing);
      let score = 0;
      for (const part of parts) {
        const fit = fitOf(words, part);
        if (!fit) return;
        score += fit;
      }
      if (parts.length > 1 && words.names.some((name) => name.includes(needle))) score += 30;
      scored.push([score + words.lift, at, listing]);
    });
    return scored.sort((a, b) => b[0] - a[0] || a[1] - b[1]).map((row) => row[2]);
  };
}
