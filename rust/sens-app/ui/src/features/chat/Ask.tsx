import { useState, type ReactNode } from "react";
import type { Answers, Decision, Question as QuestionShape } from "../../ipc/types";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { LinesCard } from "../../shared/LinesCard";
import { CodeBlock, Markdown } from "../../shared/markdown/Markdown";
import { addedRows, replacedRows } from "../../shared/rows";
import { languageOf } from "../../shared/syntax/languages";
import { chooseMode } from "../composer/store";
import { usePane } from "../panes/context";
import { SHELLS, describe } from "./looks";
import { Ran, WebLink, DIFF_PREVIEW } from "./Step";
import { answer } from "./store";
import type { Ask as AskPart } from "./turns";

// A choice: its label, whether it is the main one, and the decision it sends,
// or how to make it (a message instead when it cannot be made yet).
type Choice = [string, boolean, Decision | (() => Decision | string)];

export function Ask({ part, reply }: { part: AskPart; reply: number }) {
  if (part.event.tool === "AskUserQuestion") return <Questions part={part} reply={reply} />;
  if (part.event.tool === "ExitPlanMode") return <Plan part={part} reply={reply} />;
  return <Permission part={part} reply={reply} />;
}

const answersText = (answers: Answers | null) =>
  answers ? Object.values(answers).map((value) => [].concat(value as never).join(", ")).join(" · ") : "";

const SETTLED: Record<string, (answers: Answers | null) => string> = {
  allowed: (answers) => answersText(answers) || "Permitido",
  refused: () => "Rechazado",
  expired: () => "Sin respuesta",
};

// The frame every question shares: what it is about, what it shows, the
// choices while it waits, and then what was decided.
function Frame({
  part,
  reply,
  icon,
  title,
  target = "",
  mono = false,
  choices,
  after,
  children,
}: {
  part: AskPart;
  reply: number;
  icon: string;
  title: string;
  target?: string;
  mono?: boolean;
  choices: Choice[];
  after?: (decision: Decision) => void;
  children: ReactNode;
}) {
  const pane = usePane();
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState("");
  const settled = SETTLED[part.state]?.(part.answers);

  async function choose(decision: Choice[2]) {
    const chosen = typeof decision === "function" ? decision() : decision;
    if (typeof chosen === "string") return setFault(chosen);
    setBusy(true);
    setFault("");
    try {
      await answer(reply, part.event.request, chosen, pane);
      after?.(chosen);
    } catch (reason) {
      setFault(String(reason));
    }
    setBusy(false);
  }

  return (
    <div className="ask" data-state={part.state || undefined}>
      <div className="ask-head">
        <span className="ask-icon">
          <Icon svg={icon} />
        </span>
        <span className="ask-title">{title}</span>
        {target && (
          <span className={mono ? "ask-target mono" : "ask-target"} title={target}>
            {target}
          </span>
        )}
      </div>
      <div className="ask-body">{children}</div>
      <div className="ask-actions" hidden={!part.active}>
        {part.active &&
          choices.map(([label, primary, decision]) => (
            <button key={label} type="button" className={primary ? "primary" : "quiet"} disabled={busy} onClick={() => choose(decision)}>
              {label}
            </button>
          ))}
      </div>
      {settled !== undefined ? (
        <p className="ask-note">{settled}</p>
      ) : (
        fault && <p className="ask-note fault">{fault}</p>
      )}
    </div>
  );
}

// Allowing for good offers to stop asking: in this session, or by accepting
// edits from now on, which then becomes the mode.
function Permission({ part, reply }: { part: AskPart; reply: number }) {
  const { tool, input, suggestions } = part.event;
  const look = describe(tool, input);
  const edits = suggestions?.some((one) => one.type === "setMode" && one.mode === "acceptEdits");
  const remember = suggestions?.length ? (edits ? "Permitir y aceptar ediciones" : "Permitir siempre en esta sesión") : "";
  const choices: Choice[] = [
    ["Permitir", true, { allow: true }],
    ...(remember ? [[remember, false, { allow: true, remember: true }] as Choice] : []),
    ["Rechazar", false, { allow: false }],
  ];
  const pane = usePane();
  const adopt = (decision: Decision) => {
    const switched = decision.remember && suggestions?.find((one) => one.type === "setMode");
    if (switched && switched.mode) chooseMode(switched.mode, pane);
  };
  return (
    <Frame part={part} reply={reply} icon={ICONS.shieldAlert} title={`Claude quiere ${look.ask || look.verb.toLowerCase()}`} target={look.target} mono={look.mono} choices={choices} after={adopt}>
      <Preview tool={tool} input={input} />
    </Frame>
  );
}

// What the tool would do: the command, the edit, the page, the search.
function Preview({ tool, input }: { tool: string; input: AskPart["event"]["input"] }) {
  const language = languageOf(input.file_path || "", input.content || "");
  if (SHELLS.has(tool)) {
    return (
      <>
        <Ran command={String(input.command || "")} />
        {input.description && <p className="ask-note">{input.description}</p>}
      </>
    );
  }
  if (tool === "Edit") return <LinesCard rows={replacedRows(input.old_string ?? "", input.new_string ?? "")} preview={DIFF_PREVIEW} language={language} />;
  if (tool === "Write") return <LinesCard rows={addedRows(input.content ?? "")} preview={DIFF_PREVIEW} language={language} />;
  if (tool === "WebFetch") {
    return (
      <>
        <WebLink url={String(input.url || "")} />
        {input.prompt && <p className="ask-note">{input.prompt}</p>}
      </>
    );
  }
  if (tool === "WebSearch") return <p className="ask-note">{input.query || ""}</p>;
  return <CodeBlock text={JSON.stringify(input, null, 2)} language="json" />;
}

// An approved plan runs in the mode chosen with it.
function Plan({ part, reply }: { part: AskPart; reply: number }) {
  const pane = usePane();
  const choices: Choice[] = [
    ["Aprobar y ejecutar", true, { allow: true, mode: "default" }],
    ["Aprobar y aceptar ediciones", false, { allow: true, mode: "acceptEdits" }],
    ["Seguir planificando", false, { allow: false, message: "Todavía no apruebo el plan. Sigue refinándolo." }],
  ];
  return (
    <Frame
      part={part}
      reply={reply}
      icon={ICONS.map}
      title="Plan listo para revisar"
      choices={choices}
      after={(decision) => decision.allow && decision.mode && chooseMode(decision.mode, pane)}
    >
      <Markdown text={part.event.input.plan || ""} />
    </Frame>
  );
}

// Each question takes one option (or several), or an answer typed instead.
function Questions({ part, reply }: { part: AskPart; reply: number }) {
  const questions = part.event.input.questions || [];
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});

  const answerOf = (question: QuestionShape) => {
    const other = (typed[question.question] || "").trim();
    if (other) return other;
    const chosen = picked[question.question] || [];
    if (!chosen.length) return "";
    return question.multiSelect ? chosen : chosen[0];
  };

  const collect = (): Decision | string => {
    const answers = Object.fromEntries(questions.map((question) => [question.question, answerOf(question)]));
    if (Object.values(answers).some((value) => !value || !value.length)) return "Responde a cada pregunta o escribe tu respuesta.";
    return { allow: true, answers };
  };

  const pick = (question: QuestionShape, label: string) =>
    setPicked((now) => {
      const chosen = now[question.question] || [];
      const on = chosen.includes(label);
      const next = question.multiSelect ? (on ? chosen.filter((one) => one !== label) : [...chosen, label]) : on ? [] : [label];
      return { ...now, [question.question]: next };
    });

  const choices: Choice[] = [
    ["Responder", true, collect],
    ["Que decida Claude", false, { allow: false, message: "El usuario prefiere no responder; decide tú lo más razonable y sigue." }],
  ];

  return (
    <Frame part={part} reply={reply} icon={ICONS.question} title={questions.length > 1 ? "Claude tiene unas preguntas" : "Claude pregunta"} choices={choices}>
      {questions.map((question) => (
        <div key={question.question} className="question">
          {question.header && <span className="label">{question.header}</span>}
          <p className="q-text">{question.question}</p>
          <div className="options">
            {(question.options || []).map((option) => (
              <button
                key={option.label}
                type="button"
                className="option"
                aria-pressed={(picked[question.question] || []).includes(option.label)}
                onClick={() => pick(question, option.label)}
              >
                <span>{option.label}</span>
                {option.description && <small>{option.description}</small>}
              </button>
            ))}
          </div>
          <input
            className="field"
            placeholder="Otra respuesta…"
            autoComplete="off"
            value={typed[question.question] || ""}
            onChange={(event) => setTyped((now) => ({ ...now, [question.question]: event.target.value }))}
          />
        </div>
      ))}
    </Frame>
  );
}
