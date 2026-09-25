import { memo, useEffect, useState } from "react";
import { useStore } from "zustand";
import { openPicture } from "../../app/Dialog";
import { showTool } from "../../app/shell";
import { commands } from "../../ipc/commands";
import { ClipCard, PictureTile, inProject, isFolder, isPastedText, shownOfPath } from "../composer/Clip";
import { toldText } from "../composer/store";
import { inFolder } from "../composer/suggest";
import { present, showFile } from "../files/view";
import { usePane } from "../panes/context";
import type { Picture, You as YouTurn } from "./turns";
import { t } from "./you.copy";

export const You = memo(function You({ turn }: { turn: YouTurn }) {
  return (
    <div className="turn you">
      {turn.text && <div className="body-text">{turn.text}</div>}
      {turn.pictures.length > 0 && (
        <div className="sent-pictures" role="list" data-single={turn.pictures.length === 1 || undefined}>
          {turn.pictures.map((picture, at) => (
            <Sent key={at} picture={picture} />
          ))}
        </div>
      )}
      {turn.files.length > 0 && (
        <div className="sent-files" role="list">
          {turn.files.map((path) => (
            <SentFile key={path} path={path} />
          ))}
        </div>
      )}
    </div>
  );
});

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
  return <PictureTile src={src} name={t.sentPicture} title={t.viewPicture} label={t.viewPicture} open={(from) => openPicture(t.sentPicture, src, from)} />;
}

function SentFile({ path }: { path: string }) {
  const pane = usePane();
  const root = useStore(pane.desk, (s) => s.root);
  const pasted = isPastedText(path);
  const [text, setText] = useState(() => (pasted ? toldText(path) : undefined));

  useEffect(() => {
    if (!pasted || text !== undefined || !root) return;
    let live = true;
    commands.artifactText(inProject(path) ? inFolder(root, path) : path).then(
      (read) => live && setText(read),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [pasted, text, root, path]);

  const shown = shownOfPath(path, text);
  const read = text;
  const open =
    pasted && read !== undefined
      ? () => {
          showTool("files");
          present(shown.name, read, root);
        }
      : !pasted && !isFolder(path) && inProject(path)
        ? () => void showFile(path)
        : undefined;
  return <ClipCard shown={shown} open={open} />;
}
