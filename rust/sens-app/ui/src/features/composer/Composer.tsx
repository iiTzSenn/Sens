import { open } from "@tauri-apps/plugin-dialog";
import { StrictMode, useEffect, useLayoutEffect, useRef, useState, type AnimationEvent, type CSSProperties, type RefObject } from "react";
import { createRoot } from "react-dom/client";
import { useStore } from "zustand";
import { legacy } from "../../legacy/bridge";
import { stem, weigh } from "../../shared/format.js";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { useSheet, type Sheet } from "../../shared/useSheet";
import { chat, halt } from "../chat/store";
import { models } from "../models/store";
import { project } from "../project/store";
import { Effort, ModelPicker, ModePicker, Think } from "./Knobs";
import { attachPaths, canSend, composer, dropFile, dropPicture, fileLabel, hearDrops, send, switchTo, takePictures, warm } from "./store";

// Where you write to Claude: the folder and branch, what goes attached, the
// message, and the knobs of the next turn under it.
export function mountComposer(host: Element) {
  hearDrops();
  createRoot(host).render(
    <StrictMode>
      <Composer />
    </StrictMode>,
  );
}

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
            <Think />
            <Effort />
          </div>
        </div>
      </div>
    </div>
  );
}

function Workspace() {
  const root = useStore(project, (s) => s.root);
  const busy = useStore(chat, (s) => s.busy);
  const repo = useStore(composer, (s) => s.repo);
  const sheet = useSheet();
  const pending = repo && (repo.dirty === 1 ? "1 fichero sin confirmar" : `${repo.dirty} ficheros sin confirmar`);

  return (
    <div className="workspace">
      <button className="chipbtn" id="folder" title={root || "Elegir carpeta de trabajo"} disabled={busy} onClick={() => legacy.chooseFolder()}>
        <Icon svg={ICONS.folderSmall} />
        <span id="root">{root ? stem(root) : "Elegir carpeta…"}</span>
      </button>
      {repo && (
        <button
          className="chipbtn"
          id="branch"
          ref={sheet.anchor}
          aria-haspopup="true"
          aria-expanded={sheet.open}
          disabled={busy}
          title={[repo.detached ? `HEAD suelto en ${repo.branch}` : repo.branch, repo.dirty ? pending : ""].filter(Boolean).join(" · ")}
          onClick={sheet.toggle}
        >
          <Icon svg={ICONS.branch} />
          <span id="branch-name">{repo.branch}</span>
          {repo.dirty > 0 && <span className="dirty" id="dirty" />}
        </button>
      )}
      {repo && <Branches sheet={sheet} />}
    </div>
  );
}

// The branch you are on, and the others to switch to, filtered by name.
function Branches({ sheet }: { sheet: Sheet }) {
  const repo = useStore(composer, (s) => s.repo)!;
  const [needle, setNeedle] = useState("");
  const wanted = needle.trim().toLowerCase();
  useEffect(() => {
    if (sheet.open) setNeedle("");
  }, [sheet.open]);
  const others = repo.branches.filter((name) => name !== repo.branch);
  const shown = wanted ? others.filter((name) => name.toLowerCase().includes(wanted)) : others;

  const row = (name: string, here: boolean) => (
    <button key={name} className="branch-row" aria-current={here} title={name} onClick={() => (here ? sheet.shut() : (sheet.shut(), switchTo(name)))}>
      <span className="name">{name}</span>
      <span className="tip">
        <Icon svg={ICONS.tick} />
      </span>
    </button>
  );

  return (
    <div className="sheet" id="branches" {...sheet.sheet}>
      <div id="branch-here">{row(repo.branch, true)}</div>
      <div className="seek">
        <Icon svg={ICONS.find} />
        <input className="field" id="branch-filter" placeholder="Buscar ramas…" autoComplete="off" spellCheck={false} value={needle} onChange={(event) => setNeedle(event.target.value)} />
      </div>
      <div className="rows" id="branch-rows">
        {shown.map((name) => row(name, false))}
        {!shown.length && <p className="none">{wanted ? "Ninguna rama coincide." : "No hay más ramas."}</p>}
      </div>
    </div>
  );
}

function Clips() {
  const attached = useStore(composer, (s) => s.attached);
  const pasted = useStore(composer, (s) => s.pasted);
  if (!attached.length && !pasted.length) return null;
  return (
    <div className="clips" id="clips">
      {pasted.map((picture) => (
        <Clip key={picture.url} label={picture.name} weight={weigh(picture.bytes)} picture={picture.url} forget={() => dropPicture(picture)} />
      ))}
      {attached.map((file) => (
        <Clip key={file.path} label={fileLabel(file)} weight={weigh(file.bytes)} forget={() => dropFile(file.path)} />
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
  const root = useStore(project, (s) => s.root);
  const busy = useStore(chat, (s) => s.busy);
  const stopping = useStore(chat, (s) => s.stopping);
  const pasted = useStore(composer, (s) => s.pasted.length);
  const provider = useStore(models, (s) => s.choice.provider);
  const dropping = useStore(composer, (s) => s.dropping);
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const grown = useRef(0);
  const lap = useLap(busy);
  const dictation = useDictation(text, setText, field);

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
    if (!canSend(text)) return;
    const said = text;
    setText("");
    await send(said);
  }

  return (
    <div className="box" data-busy={String(busy)} data-stopping={String(stopping)} data-drop={dropping ? "true" : undefined} style={lap.style} onAnimationIteration={lap.next}>
      <button
        className="round"
        id="attach"
        title="Adjuntar ficheros"
        aria-label="Adjuntar ficheros"
        disabled={!root || busy}
        onClick={async () => {
          const picked = await open({ multiple: true, title: "Adjuntar ficheros o imágenes", defaultPath: root });
          if (picked) await attachPaths(Array.isArray(picked) ? picked : [picked]);
        }}
      >
        <Icon svg={ICONS.paperclip} />
      </button>
      <button
        className="round"
        id="dictate"
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
        id="task"
        rows={1}
        placeholder="Pide lo que necesites…"
        aria-label="Mensaje para Claude"
        autoComplete="off"
        disabled={!root}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          warm();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          go();
        }}
        onPaste={(event) => {
          const pictures = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith("image/"));
          if (!pictures.length) return;
          if (!event.clipboardData.getData("text/plain")) event.preventDefault();
          takePictures(pictures);
        }}
      />
      <button className="round send" id="send" title={label} aria-label={label} disabled={busy ? stopping : !ready} onClick={() => (busy ? halt() : go())}>
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
