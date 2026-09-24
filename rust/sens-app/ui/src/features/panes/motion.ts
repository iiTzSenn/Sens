const SLIDE = 260;

let still = false;

export const holdStill = () => void (still = true);

const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const host = () => document.querySelector<HTMLElement>(".panes");

export function slideShare(from: number, to: number) {
  const box = host();
  const held = still;
  still = false;
  if (!box || calm() || held) return;
  box.dataset.sliding = "true";
  box.style.setProperty("--share", String(from));
  box.getBoundingClientRect();
  box.style.setProperty("--share", String(to));
  setTimeout(() => delete box.dataset.sliding, SLIDE);
}

export function slideAway(first: boolean) {
  const box = host();
  if (!box || calm()) return Promise.resolve();
  box.dataset.sliding = "true";
  box.style.setProperty("--share", first ? "0" : "1");
  return new Promise<void>((done) =>
    setTimeout(() => {
      delete box.dataset.sliding;
      done();
    }, SLIDE),
  );
}
