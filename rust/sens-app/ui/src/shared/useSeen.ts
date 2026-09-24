import { useEffect, useState, type RefObject } from "react";

interface Sight {
  // The scrolling box it is seen in; the screen when there is none.
  root?: () => Element | null;
  // How near counts as seen, as CSS margins around the root.
  margin?: string;
  // Seen already, without waiting.
  now?: boolean;
}

// Whether an element has come near the visible part of its box, once: it stays
// seen after.
export function useSeen(target: RefObject<Element | null>, { root, margin, now = false }: Sight = {}) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen || now || !target.current) return;
    if (typeof IntersectionObserver === "undefined") return setSeen(true);
    const sight = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        sight.disconnect();
        setSeen(true);
      },
      { root: root?.() ?? null, rootMargin: margin },
    );
    sight.observe(target.current);
    return () => sight.disconnect();
  }, [seen, now]);
  return seen || now;
}
