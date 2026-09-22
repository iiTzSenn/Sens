import type { Step } from "./ui.js";

export interface Block {
  steps: Step[];
  title: string;
}

const NEXT = "Próximos pasos";

const notFound = (name: string): Block => ({
  title: "",
  steps: [
    { cmd: `exists ${name}`, hint: "buscar por palabras clave, no por nombre exacto" },
    { hint: "revisa el nombre, o reconstruye el índice con  sens index" },
  ],
});

export function find(name: string, count: number): Block {
  if (count === 0) return notFound(name);
  return {
    title: NEXT,
    steps: [
      { cmd: `who ${name}`, hint: "ver quién lo usa" },
      { cmd: `explain ${name}`, hint: "ver qué lo llama y a qué llama" },
    ],
  };
}

export function who(name: string, count: number): Block {
  if (count === 0) return notFound(name);
  return {
    title: NEXT,
    steps: [
      { cmd: `explain ${name}`, hint: "ver el grafo de llamadas" },
      { cmd: `find ${name}`, hint: "ir a la definición" },
    ],
  };
}

export function explain(name: string, count: number): Block {
  if (count === 0) return notFound(name);
  return { title: NEXT, steps: [{ cmd: `who ${name}`, hint: "listar todos los usos" }] };
}

export function path(from: string, to: string, connected: boolean): Block {
  if (!connected)
    return {
      title: "",
      steps: [
        { cmd: `explain ${from}`, hint: `ver los vecinos de ${from}` },
        { cmd: `explain ${to}`, hint: `ver los vecinos de ${to}` },
      ],
    };
  return { title: NEXT, steps: [{ cmd: `explain ${from}`, hint: "ver el grafo alrededor" }] };
}

export function outline(file: string, count: number): Block {
  if (count === 0)
    return {
      title: "",
      steps: [
        { hint: "revisa la ruta del archivo" },
        { cmd: "map", hint: "ver el mapa del proyecto" },
      ],
    };
  return {
    title: NEXT,
    steps: [{ cmd: `deps ${file}`, hint: "ver qué importa y quién lo importa" }],
  };
}

export function exists(query: string, count: number, topName?: string): Block {
  if (count === 0)
    return { title: "", steps: [{ hint: "nada parecido — parece seguro crearlo" }] };
  const steps: Step[] = [{ hint: "reusa lo que ya existe en vez de duplicar" }];
  if (topName) steps.push({ cmd: `who ${topName}`, hint: "ver dónde se usa el candidato más cercano" });
  return { title: NEXT, steps };
}

export function deadCode(count: number, topName?: string): Block {
  if (count === 0) return { title: "", steps: [] };
  const steps: Step[] = [];
  if (topName) steps.push({ cmd: `who ${topName}`, hint: "confirmar que no se usa antes de borrar" });
  steps.push({ hint: "son candidatos: verifica uso dinámico / reflexión primero" });
  return { title: NEXT, steps };
}

export function deps(file: string): Block {
  return {
    title: NEXT,
    steps: [{ cmd: `outline ${file}`, hint: "ver las firmas del archivo" }],
  };
}
