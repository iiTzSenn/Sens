import type { ReactNode, Ref } from "react";

// A command and what it printed, as a terminal shows it. `state` is set once
// the command ran.
export function Terminal({
  command,
  output,
  state,
  foot = "",
  outRef,
}: {
  command: string;
  output?: ReactNode;
  state?: "done" | "failed";
  foot?: string;
  outRef?: Ref<HTMLPreElement>;
}) {
  return (
    <div className="terminal" data-state={state}>
      <div className="terminal-command">
        <span className="prompt">$</span>
        <span>{command}</span>
      </div>
      <pre className="terminal-output" ref={outRef} hidden={!output}>
        {output}
      </pre>
      {foot && <div className="terminal-foot">{foot}</div>}
    </div>
  );
}
