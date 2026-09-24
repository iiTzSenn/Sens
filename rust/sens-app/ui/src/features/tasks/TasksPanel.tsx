import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { commands } from "../../ipc/commands";
import { panelShows } from "../../app/shell";
import { FoldedText } from "../../shared/Folded";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { Markdown } from "../../shared/markdown/Markdown";
import { Terminal } from "../../shared/Terminal";
import { project } from "../project/store";
import { tasks, tickTasks } from "./store";
import { TASK_STATE, inOrder, isAgent, isRunning, isShell, shellEnding, tally, taskTime, taskUsage, type Task } from "./tasks";

// How many run and how many ended, for the panel's header.
export const TaskTally = () => tally(useStore(tasks, (s) => s.tasks));

export function TasksPanel() {
  const all = useStore(tasks, (s) => s.tasks);
  const now = useStore(tasks, (s) => s.now);
  const list = inOrder(all);
  const running = list.some(isRunning);

  useEffect(() => {
    if (!running) return;
    const clock = setInterval(() => {
      if (panelShows("tasks")) tickTasks();
    }, 1000);
    return () => clearInterval(clock);
  }, [running]);

  return (
    <>
      {list.length ? (
        list.map((task) => <TaskCard key={task.id} task={task} now={now} />)
      ) : (
        <p className="none">Aquí verás los subagentes y los comandos que el modelo lance en segundo plano.</p>
      )}
    </>
  );
}

function TaskCard({ task, now }: { task: Task; now: number }) {
  const [open, setOpen] = useState(false);
  const shell = isShell(task);
  const agent = isAgent(task);
  return (
    <details
      className="step task"
      data-state={TASK_STATE[task.status] || "done"}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="step-icon">
          <Icon svg={shell ? ICONS.terminal : agent ? ICONS.split : ICONS.wrench} />
        </span>
        <span className="step-verb">{shell ? "Comando" : agent ? "Subagente" : "Tarea"}</span>
        <span className="step-target" title={task.description || ""}>
          {task.description || task.id}
        </span>
        <span className="step-meta">{taskTime(task, now)}</span>
        <span className="step-state" />
      </summary>
      <div className="step-body">
        {shell ? <ShellBody task={task} open={open} now={now} /> : <AgentBody task={task} />}
        <StopTask task={task} />
      </div>
    </details>
  );
}

// While the card is open, what the command prints is read again with every
// update, until it has ended and its output was read once more. The output
// keeps to the bottom unless scrolled up.
function ShellBody({ task, open, now }: { task: Task; open: boolean; now: number }) {
  const [output, setOutput] = useState("");
  const out = useRef<HTMLPreElement>(null);
  const settled = useRef(false);
  const reading = useRef(false);
  const again = useRef(false);
  const stick = useRef(true);

  async function read(path: string) {
    if (!path) return;
    if (reading.current) {
      again.current = true;
      return;
    }
    reading.current = true;
    let text: string;
    try {
      text = (await commands.taskOutput(path)).replace(/\s+$/, "");
    } catch (reason) {
      text = String(reason);
    }
    const pre = out.current;
    stick.current = !pre || pre.scrollHeight - pre.scrollTop - pre.clientHeight < 24;
    setOutput(text);
    reading.current = false;
    if (again.current) {
      again.current = false;
      read(path);
    }
  }

  useEffect(() => {
    if (!open || settled.current) return;
    settled.current = !isRunning(task) && Boolean(task.output);
    read(task.output);
  }, [open, task, now]);

  useLayoutEffect(() => {
    if (stick.current && out.current) out.current.scrollTop = out.current.scrollHeight;
  }, [output]);

  return (
    <Terminal
      command={String(task.input.command || task.description || "")}
      output={output}
      state={task.status === "failed" ? "failed" : "done"}
      foot={shellEnding(task)}
      outRef={out}
    />
  );
}

function AgentBody({ task }: { task: Task }) {
  const usage = taskUsage(task);
  return (
    <>
      {task.prompt && <FoldedText text={task.prompt} />}
      <p className="task-doing" hidden={!usage}>
        {usage}
      </p>
      <div className="task-said">{task.summary && <Markdown text={task.summary} />}</div>
    </>
  );
}

// Once asked, the button stays off: the task ends and the card says so.
function StopTask({ task }: { task: Task }) {
  const [asked, setAsked] = useState(false);
  const [trouble, setTrouble] = useState("");

  async function stop() {
    setAsked(true);
    setTrouble("");
    try {
      await commands.stopTask(project.getState().session, task.id);
    } catch (reason) {
      setTrouble(String(reason));
      setAsked(false);
    }
  }

  return (
    <div className="task-actions" hidden={!isRunning(task)}>
      <button className="quiet" type="button" disabled={asked} onClick={stop}>
        Detener
      </button>
      <span className="fault">{trouble}</span>
    </div>
  );
}
