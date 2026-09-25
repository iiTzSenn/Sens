import type { Listing } from "../../ipc/types";
import { Favicon } from "../../shared/Favicon";
import { Icon } from "../../shared/Icon";
import { faceOf, monogramOf } from "./faces";

export function Face({ title, site, icon, big = false }: { title: string; site: string; icon?: string; big?: boolean }) {
  return (
    <Favicon className="mk-face" site={site} art={icon ? "icon" : "mark"} data-big={big || undefined}>
      {icon ? <Icon svg={icon} /> : <span className="mk-mark">{monogramOf(title)}</span>}
    </Favicon>
  );
}

export function ListingFace({ listing, big = false }: { listing: Listing; big?: boolean }) {
  const site = faceOf(listing);
  return <Face key={site} title={listing.title} site={site} big={big} />;
}
