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
