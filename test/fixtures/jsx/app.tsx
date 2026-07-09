// Button and Panel are used ONLY through JSX (<Button/>, <Panel/>), never called
// like functions. A resolver that ignores JSX tag names would wrongly flag them
// as dead code. mount() is called at module scope, so it's a genuine root.
export function Button(): unknown {
  return null;
}

function Panel(): unknown {
  return <Button />;
}

function mount(): unknown {
  return <Panel />;
}

mount();
