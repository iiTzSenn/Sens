import { useLayoutEffect, useRef, type DependencyList } from "react";

// Hosts nodes that app.js draws (markdown, diffs, folded text) inside an
// element React renders but never fills itself. They are drawn again when
// `deps` change.
export function useBorrowed<Host extends HTMLElement = HTMLDivElement>(make: () => Node | Node[], deps: DependencyList) {
  const host = useRef<Host>(null);
  useLayoutEffect(() => {
    const made = make();
    host.current?.replaceChildren(...(Array.isArray(made) ? made : [made]));
  }, deps);
  return host;
}

// The same, in a box that takes no room of its own: its nodes lay out as if
// they were children of its parent.
export function Borrowed({ make, made }: { make: () => Node; made: unknown }) {
  const host = useBorrowed(make, [made]);
  return <div style={{ display: "contents" }} ref={host} />;
}
