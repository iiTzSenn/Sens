// Places a menu that floats over the shell by what opened it: below it and
// flush with its right edge, above it when there is no room below, always
// inside the window.
export function anchorMenu(menu: HTMLElement, anchor: Element) {
  menu.hidden = false;
  menu.style.visibility = "hidden";
  const at = anchor.getBoundingClientRect();
  const size = menu.getBoundingClientRect();
  const edge = 12;
  const below = at.bottom + 6;
  const fits = below + size.height <= window.innerHeight - edge;
  menu.style.top = `${fits ? below : Math.max(edge, at.top - 6 - size.height)}px`;
  menu.style.left = `${Math.min(Math.max(edge, at.right - size.width), window.innerWidth - size.width - edge)}px`;
  menu.style.visibility = "";
}
