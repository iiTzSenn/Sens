import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useStore } from "zustand";
import { legacy } from "../../legacy/bridge";
import { seconds, whole } from "../../shared/format.js";
import { Ask } from "./Ask";
import { grain } from "./grain";
import { Said, Thought } from "./Said";
import { Step } from "./Step";
import { chat, hearChat } from "./store";
import type { Notice as NoticeTurn, Picture, Reply as ReplyTurn, You as YouTurn } from "./turns";

// Within this of the bottom, the chat follows what arrives.
const NEAR_BOTTOM = 160;

// The conversation: what arrives keeps it at the bottom unless you scrolled
// up to read; the edges fade where there is more to scroll.
export function mountThread(host: Element) {
  hearChat();
  createRoot(host).render(
    <StrictMode>
      <Thread />
    </StrictMode>,
  );
}

export function Thread() {
  const turns = useStore(chat, (s) => s.turns);
  const hint = useStore(chat, (s) => s.hint);
  const replaying = useStore(chat, (s) => s.replaying);
  const thread = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [edges, setEdges] = useState({ over: false, under: false });

  const paint = () => {
    const box = thread.current;
    if (!box) return;
    const room = box.scrollHeight - box.clientHeight;
    setEdges({ over: box.scrollTop > 8, under: room - box.scrollTop > 8 });
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
    <div className="stream" id="stream" data-over={String(edges.over)} data-under={String(edges.under)}>
      <div
        className="thread"
        id="thread"
        ref={thread}
        data-replaying={replaying ? "true" : undefined}
        onScroll={() => {
          const box = thread.current!;
          stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < NEAR_BOTTOM;
          paint();
        }}
      >
        <div className="thread-inner" id="thread-inner" ref={inner}>
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

function You({ turn }: { turn: YouTurn }) {
  return (
    <div className="turn you">
      <div className="body-text">{turn.text}</div>
      {turn.pictures.length > 0 && (
        <div className="asked-pictures">
          {turn.pictures.map((picture, at) => (
            <Sent key={at} picture={picture} />
          ))}
        </div>
      )}
      {turn.files.length > 0 && (
        <div className="asked-files">
          {turn.files.map((file) => (
            <span key={file}>{file}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// A picture sent with a message, larger on click; gone if it cannot be read.
function Sent({ picture }: { picture: Picture }) {
  const [src, setSrc] = useState(typeof picture === "string" ? picture : "");
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (typeof picture === "string") return;
    let live = true;
    picture.then(
      (read) => live && setSrc(read),
      () => live && setGone(true),
    );
    return () => {
      live = false;
    };
  }, [picture]);

  if (gone) return null;
  return (
    <button
      type="button"
      title="Ver imagen"
      aria-label="Ver imagen"
      onClick={(event) => {
        if (!src) return;
        const shown = Object.assign(document.createElement("img"), { className: "sight", alt: "Imagen enviada", src });
        legacy.preview("Imagen enviada", event.currentTarget, shown);
      }}
    >
      <img alt="" src={src || undefined} />
    </button>
  );
}

function Notice({ turn }: { turn: NoticeTurn }) {
  return (
    <div className={turn.tone ? `tick ${turn.tone}` : "tick"}>
      <span className="dot" />
      <span>{turn.parts.map((part, at) => (typeof part === "string" ? part : <b key={at}>{part.bold}</b>))}</span>
    </div>
  );
}

function Reply({ turn }: { turn: ReplyTurn }) {
  return (
    <div className="turn reply">
      {turn.who && <div className="who">{turn.who}</div>}
      <div className="flow">
        {turn.parts.map((part) => {
          switch (part.kind) {
            case "said":
              return <Said key={part.key} part={part} />;
            case "thought":
              return <Thought key={part.key} part={part} />;
            case "step":
              return <Step key={part.key} part={part} />;
            case "ask":
              return <Ask key={part.key} part={part} reply={turn.key} />;
            case "fault":
              return (
                <p key={part.key} className="reply-fault">
                  {part.text}
                </p>
              );
            case "foot":
              return (
                <div key={part.key} className="reply-foot">
                  {part.text}
                </div>
              );
          }
        })}
      </div>
      {turn.working && <Live said={turn.working} began={turn.began} />}
    </div>
  );
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

// The canvas is made here and handed to WebGL, and goes with its context when
// the welcome does; without WebGL2 the word shows plain.
function Hello({ hint }: { hint: string }) {
  const mark = useRef<HTMLDivElement>(null);
  const [lit, setLit] = useState(false);

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
  }, []);

  return (
    <div className="hello">
      <div className="hello-mark" ref={mark} data-grain={lit ? "on" : undefined}>
        <span className="hello-word">sens</span>
      </div>
      <p className="hello-hint">{hint}</p>
    </div>
  );
}
