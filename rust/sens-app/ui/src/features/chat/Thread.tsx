import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { compact, seconds, whole } from "../../shared/format.js";
import { look } from "../../shared/look";
import { useIds, usePane } from "../panes/context";
import { Ask } from "./Ask";
import { grain } from "./grain";
import { Run } from "./Run";
import { Said } from "./Said";
import { HINTS, t } from "./thread.copy";
import type { Compacted as CompactedPart, Foot as FootPart, Notice as NoticeTurn, Reply as ReplyTurn } from "./turns";
import { FOLD_AT, grouped } from "./work";
import { You } from "./You";

// Within this of the bottom, the chat follows what arrives.
const NEAR_BOTTOM = 160;

// The conversation: what arrives keeps it at the bottom unless you scrolled
// up to read; the edges fade where there is more to scroll.
export function Thread() {
  const pane = usePane();
  const id = useIds();
  const turns = useStore(pane.chat, (s) => s.turns);
  const hint = useStore(pane.chat, (s) => s.hint);
  const replaying = useStore(pane.chat, (s) => s.replaying);
  const thread = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [edges, setEdges] = useState({ over: false, under: false });

  const paint = () => {
    const box = thread.current;
    if (!box) return;
    const room = box.scrollHeight - box.clientHeight;
    const over = box.scrollTop > 8;
    const under = room - box.scrollTop > 8;
    setEdges((was) => (was.over === over && was.under === under ? was : { over, under }));
  };

  useEffect(() => {
    const follow = new ResizeObserver(() => {
      if (stick.current && thread.current) thread.current.scrollTop = thread.current.scrollHeight;
      paint();
    });
    if (inner.current) follow.observe(inner.current);
    if (thread.current) follow.observe(thread.current);
    return () => follow.disconnect();
  }, []);

  // A new turn always shows.
  useLayoutEffect(() => {
    stick.current = true;
    if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [turns.length]);

  return (
    <div className="stream" id={id("stream")} data-over={String(edges.over)} data-under={String(edges.under)}>
      <div
        className="thread"
        id={id("thread")}
        ref={thread}
        data-replaying={replaying ? "true" : undefined}
        onScroll={() => {
          const box = thread.current!;
          stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < NEAR_BOTTOM;
          paint();
        }}
      >
        <div className="thread-inner" id={id("thread-inner")} ref={inner}>
          {turns.length ? (
            turns.map((turn) =>
              turn.kind === "you" ? <You key={turn.key} turn={turn} /> : turn.kind === "notice" ? <Notice key={turn.key} turn={turn} /> : <Reply key={turn.key} turn={turn} />,
            )
          ) : (
            <Hello hint={hint} />
          )}
        </div>
      </div>
      <div className="fade top" aria-hidden="true" />
      <div className="fade bottom" aria-hidden="true" />
    </div>
  );
}

const Notice = memo(function Notice({ turn }: { turn: NoticeTurn }) {
  return (
    <div className={turn.tone ? `tick ${turn.tone}` : "tick"}>
      <span className="dot" />
      <span>{turn.parts.map((part, at) => (typeof part === "string" ? part : <b key={at}>{part.bold}</b>))}</span>
    </div>
  );
});

const Reply = memo(function Reply({ turn }: { turn: ReplyTurn }) {
  return (
    <div className="turn reply">
      {turn.who && <div className="who">{turn.who}</div>}
      <div className="flow">
        {grouped(turn.parts).map((piece) => {
          switch (piece.kind) {
            case "run":
              return <Run key={piece.key} parts={piece.parts} folded={turn.closed && piece.parts.length >= FOLD_AT} />;
            case "said":
              return <Said key={piece.key} part={piece} />;
            case "ask":
              return <Ask key={piece.key} part={piece} reply={turn.key} />;
            case "fault":
              return (
                <p key={piece.key} className="reply-fault">
                  {piece.text}
                </p>
              );
            case "foot":
              return <Foot key={piece.key} part={piece} />;
            case "compacted":
              return <Note key={piece.key} part={piece} />;
          }
        })}
      </div>
      {turn.working && <Live said={turn.working} began={turn.began} />}
    </div>
  );
});

const JOIN = " · ";
const MARK = "\u0000";

function Foot({ part }: { part: FootPart }) {
  const [before, after] = t.tokens(MARK).split(MARK);
  const pieces: ReactNode[] = [];
  if (part.millis) pieces.push(seconds(part.millis));
  if (part.tokens)
    pieces.push(
      <>
        {before}
        <b className="foot-count">{compact(part.tokens)}</b>
        {after}
      </>,
    );
  if (part.stopped) pieces.push(t.stopped);
  return (
    <div className="reply-foot">
      {pieces.map((piece, at) => (
        <Fragment key={at}>
          {at > 0 && JOIN}
          <span>{piece}</span>
        </Fragment>
      ))}
    </div>
  );
}

function Note({ part }: { part: CompactedPart }) {
  return <p className="reply-note">{[part.auto ? t.compactedByClaude : t.compacted, part.before ? t.before(compact(part.before)) : ""].filter(Boolean).join(JOIN)}</p>;
}

// While Claude works: what it is doing, and for how long.
function Live({ said, began }: { said: string; began: number }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const clock = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(clock);
  }, []);
  return (
    <div className="live">
      <span className="pulse" />
      <span className="live-said">{said}</span>
      <span className="live-clock">{seconds(whole(now - began))}</span>
    </div>
  );
}

let lastHint = -1;

function nextHint() {
  let at = lastHint;
  while (at === lastHint) at = Math.floor(Math.random() * HINTS);
  return (lastHint = at);
}

// The canvas is made here and handed to WebGL, and goes with its context when
// the welcome does; without WebGL2 the word shows plain.
function Hello({ hint }: { hint: string }) {
  const mark = useRef<HTMLDivElement>(null);
  const [lit, setLit] = useState(false);
  const tone = useStore(look, (s) => `${s.shown} ${s.chosen.accent}`);
  const pane = usePane();
  const folder = useStore(pane.desk, (s) => Boolean(s.root));
  const nth = useMemo(nextHint, [hint]);

  useEffect(() => {
    if (!mark.current) return;
    const canvas = Object.assign(document.createElement("canvas"), { ariaHidden: "true" });
    const stop = grain(canvas, mark.current);
    if (!stop) return;
    mark.current.prepend(canvas);
    setLit(true);
    return () => {
      stop();
      canvas.remove();
    };
  }, [tone]);

  return (
    <div className="hello">
      <div className="hello-mark" ref={mark} data-grain={lit ? "on" : undefined}>
        <span className="hello-word">sens AI</span>
      </div>
      <p className="hello-hint">{folder ? t.hint(nth) : t.noFolder}</p>
    </div>
  );
}
