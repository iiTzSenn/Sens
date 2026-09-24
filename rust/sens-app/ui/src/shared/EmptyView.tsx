import { Icon } from "./Icon";

export function EmptyView({ art, lead, said }: { art: string; lead: string; said: string }) {
  return (
    <div className="rail-empty view-empty">
      <Icon svg={art} />
      <p className="lead">{lead}</p>
      <p>{said}</p>
    </div>
  );
}
