import type { ILink, ILinkHandler, ILinkProvider, Terminal } from "@xterm/xterm";
import { marksOf } from "../../shared/output";
import { openOutside } from "../../shared/outside";
import { relative } from "../chat/looks";
import { showFile } from "../files/view";
import { project } from "../project/store";

const LONGEST = 4_000;
const WEB = /^https?:\/\//i;

export const webLinks: ILinkHandler = {
  activate: (_event, url) => {
    if (WEB.test(url)) openOutside(url);
  },
};

export function linksOf(xterm: Terminal): ILinkProvider {
  return {
    provideLinks(row, answer) {
      const buffer = xterm.buffer.active;
      let first = row - 1;
      while (first > 0 && buffer.getLine(first)?.isWrapped) first--;
      let last = row - 1;
      while (buffer.getLine(last + 1)?.isWrapped) last++;
      const reused = buffer.getNullCell();
      const spots: { x: number; y: number }[] = [];
      let text = "";
      for (let y = first; y <= last && text.length < LONGEST; y++) {
        const line = buffer.getLine(y);
        for (let x = 0; line && x < line.length; x++) {
          const cell = line.getCell(x, reused);
          if (!cell?.getWidth()) continue;
          const chars = cell.getChars() || " ";
          for (let unit = 0; unit < chars.length; unit++) spots.push({ x: x + 1, y: y + 1 });
          text += chars;
        }
      }
      const links: ILink[] = marksOf(text, Boolean(project.getState().work))
        .filter((mark) => spots[mark.from]?.y <= row && spots[mark.to - 1]?.y >= row)
        .map((mark) => ({
          range: { start: spots[mark.from], end: spots[mark.to - 1] },
          text: text.slice(mark.from, mark.to),
          activate: () => (mark.url ? openOutside(mark.url) : showFile(relative(mark.path!))),
        }));
      answer(links.length ? links : undefined);
    },
  };
}
