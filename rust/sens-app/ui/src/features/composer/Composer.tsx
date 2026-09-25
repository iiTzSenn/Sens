import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useLayoutEffect, useRef, useState, type AnimationEvent, type CSSProperties, type RefObject } from "react";
import { useStore } from "zustand";
import { chooseFolder } from "../../app/session";
import { stem, weigh } from "../../shared/format.js";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { useSheet, type Sheet } from "../../shared/useSheet";
import { halt } from "../chat/store";
import { useIds, usePane } from "../panes/context";
import { panes } from "../panes/store";
import { ContextMeter, Effort, ModelPicker, ModePicker, Think } from "./Knobs";
import { Suggestions, useSuggestions } from "./Suggestions";
import { attachPaths, canSend, composer, dropFile, dropPicture, fileLabel, send, switchTo, takePictures, toggleIsolate, warm, writeMessage } from "./store";

// Where you write to Claude: the folder and branch, what goes attached, the
// message, and the knobs of the next turn under it.
export function Composer() {
  return (
    <div className="composer">
      <div className="composer-inner">
        <Workspace />
        <Clips />
        <Box />
        <div className="under">
          <div className="knobs">
            <ModelPicker />
            <ModePicker />
          </div>
          <div className="knobs-right">
            <ContextMeter />
            <Think />
            <Effort />
          </div>
        </div>
      </div>
    </div>
  );
}

function Workspace() {
  const pane = usePane();
  const id = useIds();
  const root = useStore(pane.desk, (s) => s.root);
  const busy = useStore(pane.chat, (s) => s.busy);
  const repo = useStore(pane.desk, (s) => s.repo);
  const sheet = useSheet();
  const pending = repo && (repo.dirty === 1 ? "1 fichero sin confirmar" : `${repo.dirty} ficheros sin confirmar`);

  return (
    <div className="workspace">
      <button className="chipbtn" id={id("folder")} title={root || "Elegir carpeta de trabajo"} disabled={busy} onClick={() => chooseFolder()}>
        <Icon svg={ICONS.folderSmall} />
        <span id={id("root")}>{root ? stem(root) : "Elegir carpeta…"}</span>
      </button>
      {repo && (
        <button
          className="chipbtn"
          id={id("branch")}
          ref={sheet.anchor}
          aria-haspopup="true"
          aria-expanded={sheet.open}
          disabled={busy}
          title={[repo.detached ? `HEAD suelto en ${repo.branch}` : repo.branch, repo.dirty ? pending : ""].filter(Boolean).join(" · ")}
          onClick={sheet.toggle}
        >
          <Icon svg={ICONS.branch} />
          <span id={id("branch-name")}>{repo.branch}</span>
          {repo.dirty > 0 && <span className="dirty" id={id("dirty")} />}
        </button>
      )}
      {repo && <Branches sheet={sheet} />}
      <WorktreeChip />
    </div>
  );
}

const ISOLATE_HELP = "Trabaja en una copia aparte del repositorio, en una rama nueva: lo que haga Claude no toca tu carpeta hasta que lo fusiones.";

function WorktreeChip() {
  const pane = usePane();
  const id = useIds();
  const repo = useStore(pane.desk, (s) => Boolean(s.repo));
  const session = useStore(pane.desk, (s) => s.session);
  const worktree = useStore(pane.desk, (s) => s.worktree);
  const isolate = useStore(pane.desk, (s) => s.isolate);
  const busy = useStore(pane.chat, (s) => s.busy);
  if (worktree)
    return (
      <span className="chipbtn worktree-chip" id={id("worktree")} title={`Trabaja en un worktree aparte, en la rama ${worktree.branch} (creada desde ${worktree.base}): ${worktree.path}`}>
        <Icon svg={ICONS.fork} />
        <span>worktree</span>
      </span>
    );
  if (!repo || session) return null;
  return (
    <button className="chipbtn" id={id("isolate")} aria-pressed={isolate} disabled={busy} title={ISOLATE_HELP} onClick={() => toggleIsolate(pane)}>
      <Icon svg={ICONS.fork} />
      <span>Worktree</span>
    </button>
  );
}

// The branch you are on, and the others to switch to, filtered by name.
function Branches({ sheet }: { sheet: Sheet }) {
  const pane = usePane();
  const id = useIds();
  const repo = useStore(pane.desk, (s) => s.repo)!;
  const [needle, setNeedle] = useState("");
  const wanted = needle.trim().toLowerCase();
  useEffect(() => {
    if (sheet.open) setNeedle("");
  }, [sheet.open]);
  const others = repo.branches.filter((name) => name !== repo.branch);
  const shown = wanted ? others.filter((name) => name.toLowerCase().includes(wanted)) : others;

  const row = (name: string, here: boolean) => (
    <button key={name} className="branch-row" aria-current={here} title={name} onClick={() => (here ? sheet.shut() : (sheet.shut(), switchTo(name, pane)))}>
      <span className="name">{name}</span>
      <span className="tip">
        <Icon svg={ICONS.tick} />
      </span>
    </button>
  );

  return (
    <div className="sheet" id={id("branches")} {...sheet.sheet}>
      <div id={id("branch-here")}>{row(repo.branch, true)}</div>
      <div className="seek">
        <Icon svg={ICONS.find} />
        <input className="field" id={id("branch-filter")} placeholder="Buscar ramas…" autoComplete="off" spellCheck={false} value={needle} onChange={(event) => setNeedle(event.target.value)} />
      </div>
      <div className="rows" id={id("branch-rows")}>
        {shown.map((name) => row(name, false))}
        {!shown.length && <p className="none">{wanted ? "Ninguna rama coincide." : "No hay más ramas."}</p>}
      </div>
    </div>
  );
}

function Clips() {
  const pane = usePane();
  const id = useIds();
  const attached = useStore(pane.desk, (s) => s.attached);
  const pasted = useStore(pane.desk, (s) => s.pasted);
  if (!attached.length && !pasted.length) return null;
  return (
    <div className="clips" id={id("clips")}>
      {pasted.map((picture) => (
        <Clip key={picture.url} label={picture.name} weight={weigh(picture.bytes)} picture={picture.url} forget={() => dropPicture(picture, pane)} />
      ))}
      {attached.map((file) => (
        <Clip key={file.path} label={fileLabel(file)} weight={weigh(file.bytes)} forget={() => dropFile(file.path, pane)} />
      ))}
    </div>
  );
}

function Clip({ label, weight, picture, forget }: { label: string; weight: string; picture?: string; forget: () => void }) {
  return (
    <div className={picture ? "clip picture" : "clip"}>
      {picture && <img src={picture} alt="" />}
      <span>{label}</span>
      <b>{weight}</b>
      <button title={`Quitar ${label}`} aria-label={`Quitar ${label}`} onClick={forget}>
        <Icon svg={ICONS.remove} />
      </button>
    </div>
  );
}

// The message grows with what is written, up to a cap, then scrolls.
const GROW_CAP = 260;

function Box() {
  const pane = usePane();
  const id = useIds();
  const root = useStore(pane.desk, (s) => s.root);
  const busy = useStore(pane.chat, (s) => s.busy);
  const stopping = useStore(pane.chat, (s) => s.stopping);
  const pasted = useStore(pane.desk, (s) => s.pasted.length);
  const provider = useStore(pane.desk, (s) => s.choice.provider);
  const here = useStore(panes, (s) => s.focus === pane.id);
  const dropping = useStore(composer, (s) => s.dropping) && here;
  const text = useStore(pane.desk, (s) => s.text);
  const setText = (next: string) => writeMessage(next, pane);
  const field = useRef<HTMLTextAreaElement>(null);
  const grown = useRef(0);
  const lap = useLap(busy);
  const dictation = useDictation(text, setText, field);
  const suggest = useSuggestions(pane, text, field, id("suggest"));

  useLayoutEffect(() => {
    const box = field.current;
    if (!box) return;
    const cap = Math.max(96, Math.min(GROW_CAP, Math.round(window.innerHeight * 0.4)));
    box.style.transition = "none";
    box.style.height = "auto";
    const wanted = Math.min(box.scrollHeight, cap);
    box.style.height = `${grown.current || wanted}px`;
    void box.offsetHeight;
    box.style.transition = "";
    box.style.height = `${wanted}px`;
    box.dataset.capped = String(wanted >= cap);
    grown.current = wanted;
  }, [text]);

  const ready = Boolean(root && provider && (text.trim() || pasted));
  const label = busy ? (stopping ? "Parando…" : "Parar") : "Enviar";

  async function go() {
    if (busy || !canSend(text, pane)) return;
    const said = text;
    setText("");
    await send(said, pane);
  }

  return (
    <div className="box" data-busy={String(busy)} data-stopping={String(stopping)} data-drop={dropping ? "true" : undefined} style={lap.style} onAnimationIteration={lap.next}>
      <Suggestions suggest={suggest} />
      <button
        className="round"
        id={id("attach")}
        title="Adjuntar ficheros"
        aria-label="Adjuntar ficheros"
        disabled={!root || busy}
        onClick={async () => {
          const picked = await open({ multiple: true, title: "Adjuntar ficheros o imágenes", defaultPath: root });
          if (picked) await attachPaths(Array.isArray(picked) ? picked : [picked], pane);
        }}
      >
        <Icon svg={ICONS.paperclip} />
      </button>
      <button
        className="round"
        id={id("dictate")}
        title={dictation.able ? "Dictar" : "Este sistema no trae dictado en el WebView"}
        aria-label={dictation.able ? "Dictar" : "Este sistema no trae dictado en el WebView"}
        aria-pressed={dictation.listening}
        disabled={!dictation.able}
        onClick={dictation.toggle}
      >
        <Icon svg={ICONS.mic} />
      </button>
      <textarea
        ref={field}
        id={id("task")}
        rows={1}
        placeholder="Pide lo que necesites · @ para un fichero, / para un comando"
        aria-label="Mensaje para Claude"
        aria-autocomplete="list"
        aria-expanded={suggest.open}
        aria-controls={suggest.open ? suggest.listId : undefined}
        aria-activedescendant={suggest.open ? suggest.optionId(suggest.active) : undefined}
        autoComplete="off"
        disabled={!root}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          suggest.follow(event);
          warm(pane);
        }}
        onSelect={suggest.follow}
        onFocus={suggest.focus}
        onBlur={suggest.blur}
        onKeyDown={(event) => {
          if (suggest.keyDown(event)) return;
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          go();
        }}
        onPaste={(event) => {
          const pictures = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith("image/"));
          if (!pictures.length) return;
          if (!event.clipboardData.getData("text/plain")) event.preventDefault();
          takePictures(pictures, pane);
        }}
      />
      <button className="round send" id={id("send")} title={label} aria-label={label} disabled={busy ? stopping : !ready} onClick={() => (busy ? halt(pane) : go())}>
        <span className="go">
          <Icon svg={ICONS.arrowUp} />
        </span>
        <span className="halt">
          <Icon svg={ICONS.stopSquare} />
        </span>
      </button>
    </div>
  );
}

// While Claude works a light laps the box, at a speed that wanders: each lap
// gets new keyframes, from a few random harmonics.
const HARMONICS = [1, 2, 3];
const SWELL = [0.04, 0.12];
const SAMPLES = 60;
const LAP = [2800, 4000];

const between = ([low, high]: number[]) => low + Math.random() * (high - low);

function lapKeyframes(name: string) {
  const waves = HARMONICS.map((turns) => ({ turns, swell: between(SWELL) / turns, phase: Math.random() * Math.PI * 2 }));
  const speed = (at: number) => waves.reduce((sum, wave) => sum + wave.swell * (Math.sin(2 * Math.PI * wave.turns * at + wave.phase) - Math.sin(wave.phase)), 1);
  const walked = [0];
  for (let step = 1; step <= SAMPLES; step++) walked.push(walked[step - 1] + speed((step - 0.5) / SAMPLES));
  const lap = walked[SAMPLES];
  const rows = walked.map((far, step) => `${((step / SAMPLES) * 100).toFixed(2)}% { --spin: ${((far / lap) * 360).toFixed(2)}deg; }`);
  return `@keyframes ${name} { ${rows.join(" ")} }`;
}

let laps: HTMLStyleElement | null = null;

function useLap(busy: boolean) {
  const [turn, setTurn] = useState({ name: "orbit", time: "2200ms" });
  const reseed = () =>
    setTurn(({ name }) => {
      const next = name === "orbit-0" ? "orbit-1" : "orbit-0";
      laps ??= document.head.appendChild(document.createElement("style"));
      laps.textContent = lapKeyframes(next);
      return { name: next, time: `${Math.round(between(LAP))}ms` };
    });
  useEffect(() => {
    if (busy) reseed();
  }, [busy]);
  return {
    style: { "--lap-name": turn.name, "--lap-time": turn.time } as CSSProperties,
    next: (event: AnimationEvent) => (event.nativeEvent as globalThis.AnimationEvent).pseudoElement === "::after" && reseed(),
  };
}

// Dictation in Spanish, while the WebView has it: what is heard follows what
// was written before, and the message takes the focus back at the end.
type Recognition = { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; addEventListener(kind: string, heard: (event: never) => void): void };
const speech = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
const Dictation = speech.SpeechRecognition || speech.webkitSpeechRecognition;

function useDictation(text: string, setText: (text: string) => void, field: RefObject<HTMLTextAreaElement | null>) {
  const [listening, setListening] = useState<Recognition | null>(null);

  function toggle() {
    if (!Dictation) return;
    if (listening) return listening.stop();
    const heard = new Dictation();
    heard.lang = "es-ES";
    heard.continuous = true;
    heard.interimResults = true;
    const before = text.trim();
    heard.addEventListener("result", (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
      let said = "";
      for (const result of Array.from(event.results)) said += result[0].transcript;
      setText([before, said.trim()].filter(Boolean).join(" "));
    });
    const done = () => {
      setListening(null);
      field.current?.focus();
    };
    heard.addEventListener("end", done);
    heard.addEventListener("error", done);
    heard.start();
    setListening(heard);
  }

  return { able: Boolean(Dictation), listening: Boolean(listening), toggle };
}
