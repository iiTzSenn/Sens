import { useState, type HTMLAttributes, type ReactNode } from "react";

const FAVICONS = "https://icons.duckduckgo.com/ip3/";

export function Favicon({ site, art, children, ...rest }: { site: string; art?: string; children: ReactNode } & HTMLAttributes<HTMLSpanElement>) {
  const [shown, setShown] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span {...rest} data-art={shown ? "site" : art} aria-hidden="true">
      {!shown && children}
      {site && !failed && (
        <img
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          src={`${FAVICONS}${site}.ico`}
          onLoad={() => setShown(true)}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
