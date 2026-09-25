import { Fragment, type ReactNode } from "react";
import type { Look, Runs } from "./paint";

export const coloredRuns = (runs: Runs, looks: Look[]): ReactNode[] =>
  runs.map(([piece, look], at) => (look < 0 ? <Fragment key={at}>{piece}</Fragment> : <span key={at} style={looks[look]}>{piece}</span>));

export const colored = (painted: { lines: Runs[]; looks: Look[] }): ReactNode[] =>
  painted.lines.map((runs, at) => (
    <Fragment key={at}>
      {at > 0 && "\n"}
      {coloredRuns(runs, painted.looks)}
    </Fragment>
  ));
