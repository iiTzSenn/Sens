import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useLayoutEffect, useRef, useState, type AnimationEvent, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import { useStore } from "zustand";
import { openPicture } from "../../app/Dialog";
import { chooseFolder } from "../../app/session";
import { stem } from "../../shared/format.js";
import { localeNow } from "../../shared/i18n";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { useSheet, type Sheet } from "../../shared/useSheet";
import { halt } from "../chat/store";
import { showFile } from "../files/view";
import { useIds, usePane } from "../panes/context";
import { panes } from "../panes/store";
import { ClipCard, PictureTile, pictureTitle, shownOfFile } from "./Clip";
import { t } from "./copy";
import { onEdge, recall } from "./history";
import { ContextMeter } from "../models/ContextMeter";
import { Effort, ModelPicker, ModePicker, Think } from "./Knobs";
import { Suggestions, useSuggestions } from "./Suggestions";
import {
  attachPaths,
  canSend,
  composer,
  dropFile,
  dropPicture,
  inlineText,
  pasteText,
  send,
  switchTo,
  takeFiles,
  toggleIsolate,
  tooLong,
  warm,
  writeMessage,
  type File,
} from "./store";

// Where you write to Claude: the folder and branch, what goes attached, the
// message, and the knobs of the next turn under it.
export function Composer() {
  return (
    <div className="composer">
      <div className="composer-inner">
        <Workspace />
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
  const pending = repo && t.uncommitted(repo.dirty);

  return (
    <div className="workspace">
      <button className="chipbtn" id={id("folder")} title={root || t.chooseFolderTitle} disabled={busy} onClick={() => chooseFolder()}>
        <Icon svg={ICONS.folderSmall} />
        <span id={id("root")}>{root ? stem(root) : t.chooseFolder}</span>
      </button>
      {repo && (
        <button
          className="chipbtn"
          id={id("branch")}
          ref={sheet.anchor}
          aria-haspopup="true"
          aria-expanded={sheet.open}
          disabled={busy}
          title={[repo.detached ? t.detached(repo.branch) : repo.branch, repo.dirty ? pending : ""].filter(Boolean).join(" · ")}
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
      <span className="chipbtn worktree-chip" id={id("worktree")} title={t.worktreeTitle(worktree.branch, worktree.base, worktree.path)}>
        <Icon svg={ICONS.fork} />
        <span>{t.worktreeChip}</span>
      </span>
    );
  if (!repo || session) return null;
  return (
    <button className="chipbtn" id={id("isolate")} aria-pressed={isolate} disabled={busy} title={t.isolateHelp} onClick={() => toggleIsolate(pane)}>
      <Icon svg={ICONS.fork} />
      <span>{t.worktreeToggle}</span>
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
        <input className="field" id={id("branch-filter")} placeholder={t.searchBranches} autoComplete="off" spellCheck={false} value={needle} onChange={(event) => setNeedle(event.target.value)} />
      </div>
      <div className="rows" id={id("branch-rows")}>
        {shown.map((name) => row(name, false))}
        {!shown.length && <p className="none">{wanted ? t.noBranchMatch : t.noOtherBranch}</p>}
      </div>
    </div>
  );
}

const openerOf = (file: File) => (file.outside || (file.kind ?? "file") !== "file" ? undefined : () => void showFile(file.path));

function Clips({ inlined }: { inlined: () => void }) {
  const pane = usePane();
  const id = useIds();
  const attached = useStore(pane.desk, (s) => s.attached);
  const pasted = useStore(pane.desk, (s) => s.pasted);
  if (!attached.length && !pasted.length) return null;
  return (
    <div className="clips" id={id("clips")} role="list" aria-label={t.attachments}>
      {pasted.map((picture, at) => (
        <PictureTile
          key={`${at}-${picture.name}`}
          src={picture.url}
          name={picture.name}
          title={pictureTitle(picture)}
          open={(from) => openPicture(picture.name, picture.url, from)}
          remove={() => dropPicture(picture, pane)}
        />
      ))}
      {attached.map((file) => (
        <ClipCard
          key={file.path}
          shown={shownOfFile(file)}
          open={openerOf(file)}
          remove={() => dropFile(file.path, pane)}
          inline={file.kind === "text" ? () => (inlineText(file, pane), inlined()) : undefined}
        />
      ))}
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
  const clips = useStore(pane.desk, (s) => s.pasted.length + s.attached.length);
  const provider = useStore(pane.desk, (s) => s.choice.provider);
  const here = useStore(panes, (s) => s.focus === pane.id);
  const dropping = useStore(composer, (s) => s.dropping) && here;
  const text = useStore(pane.desk, (s) => s.text);
  const setText = (next: string) => writeMessage(next, pane);
  const field = useRef<HTMLTextAreaElement>(null);
  const grown = useRef(0);
  const toEnd = useRef(false);
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

  useLayoutEffect(() => {
    const box = field.current;
    if (!box || !toEnd.current) return;
    toEnd.current = false;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
    box.scrollTop = box.scrollHeight;
  }, [text]);

  const ready = Boolean(root && provider && (text.trim() || clips));
  const label = busy ? (stopping ? t.stopping : t.stop) : t.send;

  async function go() {
    if (busy || !canSend(text, pane)) return;
    const said = text;
    setText("");
    await send(said, pane);
  }

  function toTheEnd() {
    toEnd.current = true;
    const box = field.current;
    if (box && box.value === pane.desk.getState().text) {
      toEnd.current = false;
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    }
  }

  function walk(event: KeyboardEvent<HTMLTextAreaElement>) {
    const older = event.key === "ArrowUp";
    if (!older && event.key !== "ArrowDown") return false;
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing || suggest.open) return false;
    if (!onEdge(event.currentTarget, older)) return false;
    const shown = recall(pane, older);
    if (shown === null) return false;
    event.preventDefault();
    suggest.hush(shown);
    setText(shown);
    toTheEnd();
    return true;
  }

  return (
    <div className="box" data-busy={String(busy)} data-stopping={String(stopping)} data-drop={dropping ? "true" : undefined} style={lap.style} onAnimationIteration={lap.next}>
      <Suggestions suggest={suggest} />
      <Clips inlined={toTheEnd} />
      <button
        className="round"
        id={id("attach")}
        title={t.attach}
        aria-label={t.attach}
        disabled={!root || busy}
        onClick={async () => {
          const picked = await open({ multiple: true, title: t.attachDialog, defaultPath: root });
          if (picked) await attachPaths(Array.isArray(picked) ? picked : [picked], pane);
        }}
      >
        <Icon svg={ICONS.paperclip} />
      </button>
      <button
        className="round"
        id={id("dictate")}
        title={dictation.able ? t.dictate : t.noDictation}
        aria-label={dictation.able ? t.dictate : t.noDictation}
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
        placeholder={t.placeholder}
        aria-label={t.messageLabel}
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
          if (suggest.keyDown(event) || walk(event)) return;
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          go();
        }}
        onPaste={(event) => {
          const files = [...(event.clipboardData?.files || [])];
          const said = event.clipboardData?.getData("text/plain") ?? "";
          if (files.length && !said) {
            event.preventDefault();
            takeFiles(files, pane);
            return;
          }
          const pictures = files.filter((file) => file.type.startsWith("image/"));
          if (pictures.length) takeFiles(pictures, pane);
          if (!tooLong(said)) return;
          event.preventDefault();
          pasteText(said, pane);
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
      {dropping && (
        <div className="drop-hint">
          <Icon svg={ICONS.paperclip} />
          <span>{t.dropHere}</span>
        </div>
      )}
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

type Recognition = { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; addEventListener(kind: string, heard: (event: never) => void): void };
const speech = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
const Dictation = speech.SpeechRecognition || speech.webkitSpeechRecognition;

function useDictation(text: string, setText: (text: string) => void, field: RefObject<HTMLTextAreaElement | null>) {
  const [listening, setListening] = useState<Recognition | null>(null);

  function toggle() {
    if (!Dictation) return;
    if (listening) return listening.stop();
    const heard = new Dictation();
    heard.lang = localeNow();
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
