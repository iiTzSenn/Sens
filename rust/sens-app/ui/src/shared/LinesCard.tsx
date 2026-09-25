import { Fragment, useEffect, useState } from "react";
import { code } from "./copy";
import type { Row } from "./rows";
import { paintRows, type Look, type Runs } from "./syntax/paint";

const MARKS = { add: "+", del: "−", "": " ", gap: "⋯" };

// A diff's rows, the first `preview` of them until asked for the rest,
// colored as the file's language once its grammar has run.
export function LinesCard({ rows, preview, language }: { rows: Row[]; preview: number; language: string | null }) {
  const [all, setAll] = useState(false);
  const [colored, setColored] = useState<({ runs: Runs; looks: Look[] } | null)[]>([]);

  useEffect(() => {
    let live = true;
    setColored([]);
    paintRows(rows, language, () => live).then((painted) => live && setColored(painted));
    return () => {
      live = false;
    };
  }, [rows, language]);

  const shown = all ? rows : rows.slice(0, preview);
  return (
    <div className="diff">
      <div className="lines">
        {shown.map(({ kind, num, text }, at) => {
          const one = colored[at];
          return (
            <div key={at} className={kind ? `row ${kind}` : "row"}>
              <span className="num">{num ? String(num) : ""}</span>
              <span className="mark">{MARKS[kind]}</span>
              <span className="src">
                {one
                  ? one.runs.map(([piece, look], run) => (look < 0 ? <Fragment key={run}>{piece}</Fragment> : <span key={run} style={one.looks[look]}>{piece}</span>))
                  : text}
              </span>
            </div>
          );
        })}
      </div>
      {!all && rows.length > preview && (
        <button className="more" onClick={() => setAll(true)}>
          {code.moreLines(rows.length - preview)}
        </button>
      )}
    </div>
  );
}
