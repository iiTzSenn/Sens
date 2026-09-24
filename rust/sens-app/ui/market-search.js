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

export function createMarketRanker() {
  const cached = new WeakMap();
  return (list, needle) => {
    const named = [];
    const other = [];
    for (const listing of list) {
      let words = cached.get(listing);
      if (!words) {
        words = {
          name: plain(`${listing.name} ${listing.title}`),
          all: plain([listing.name, listing.title, listing.description, listing.author, listing.category].join("\n")),
        };
        cached.set(listing, words);
      }
      if (words.all.includes(needle)) (words.name.includes(needle) ? named : other).push(listing);
    }
    return named.concat(other);
  };
}
