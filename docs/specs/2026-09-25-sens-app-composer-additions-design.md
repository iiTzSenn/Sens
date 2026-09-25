# Comandos, ficheros, contexto y avisos

Fecha: 2026-09-25 · Ámbito: `rust/sens-agent/src/chat.rs`, `rust/sens-app`
(`main.rs`, `profile.rs`), `ui/src/features/composer`, `chat`, `notify`,
`settings`. Implementado.

## `/` y `@` en el mensaje

- Un mensaje que empieza por `/` ofrece los comandos de Claude Code: los suyos, las
  skills y los de los plugins activos. No hay una lista escrita en Sens: el CLI
  responde a la petición `initialize` (con id propio, `sens-initialize`) con
  `commands: [{ name, description, argumentHint }]`, y `chat_warm` los devuelve
  cuando llegan (espera como mucho 10 s; una respuesta sin comandos o con error
  cuenta como lista vacía y no hace esperar). Los internos (`__…`) se quedan
  fuera; las descripciones se cortan a 160 caracteres. Si llegó vacía, se vuelve
  a pedir con la siguiente tecla.
- `@` al empezar una palabra ofrece ficheros de la carpeta de trabajo, buscados
  con `find_files` tras 120 ms sin teclear. Elegido, queda `@ruta` (entre
  comillas si tiene espacios): Claude Code expande las menciones también en modo
  stream-json, así que no hace falta adjuntarlo aparte.
- Primero los que empiezan por lo escrito, luego los que lo contienen en el nombre,
  luego en la ruta; a igualdad, los más cortos. Como mucho 8.
- Flechas para moverse, Enter o Tab para elegir, Escape para cerrar hasta que lo
  escrito cambie. Con la lista abierta, Enter elige y no envía. La lista es un
  `listbox` con `aria-activedescendant` en el mensaje.
- El marcador del mensaje lo recuerda: «@ para un fichero, / para un comando».

## Contexto

- `Finished` trae `context`: lo que ocupaba la última llamada del turno
  (`usage.iterations`: entrada, caché leída y escrita, y salida), y `window`: la
  ventana mayor de `modelUsage`. Las sesiones anteriores, sin esos campos, leen 0.
- Un turno que compacta (`system/compact_boundary`, `Event::Compacted`) termina
  con `context: 0`: el tamaño nuevo no se sabe hasta el turno siguiente. La
  compactación se ve en la respuesta: «Conversación compactada · tenía 154k
  tokens», o «Claude Code compactó la conversación…» si la decidió él.
- Junto a razonamiento y esfuerzo, un anillo con el porcentaje; en ámbar desde el
  70 % y en rojo desde el 90 %. Su hoja dice los tokens y ofrece «Compactar
  ahora», que envía `/compact` sin llevarse lo adjuntado.
- Aparece tras el primer turno que lo dice, vuelve con la sesión guardada y se
  olvida con una sesión nueva.

## Avisos

- Si la ventana de Sens no tiene el foco (`onFocusChanged`; no `document.hasFocus()`,
  que da falso con el foco en el navegador integrado), un aviso del sistema cuando una
  sesión termina, falla o necesita algo: «Ha terminado.», «Terminó con un error.»,
  «Necesita tu permiso: Ejecutar npm test», «Tiene una pregunta para ti.», «Tiene
  un plan para que lo revises.». El título es el de la sesión.
- Un turno que se paró a mano no avisa. Las preguntas seguidas de una misma
  sesión avisan una vez cada 4 s.
- `tauri-plugin-notification`, llamado desde Rust (`notify`): no hace falta
  permiso en la ventana. En Windows sale con el AUMID `dev.sens.desktop`, el de
  los accesos directos del instalador.
- *Ajustes › General › Avisos* los apaga (`profile.json`: `notify`, encendido por
  defecto, también para perfiles anteriores).

## Contrato

| Comando | Firma JS | Devuelve / efecto |
| --- | --- | --- |
| `chat_warm` | `invoke("chat_warm", { root, sessionId, settings })` | `[{ name, description, hint }]` |
| `notify` | `invoke("notify", { title, body })` | aviso del sistema |
| `set_notify` | `invoke("set_notify", { on })` | guarda la preferencia |

## Pruebas

- `chat.rs`: comandos ofrecidos (y los internos fuera), contexto de la última
  llamada y ventana, turno sin llamadas, compactación y compatibilidad con
  sesiones anteriores. `chat_engine.rs`: `warm` devuelve los comandos; un
  `/compact` deja el contexto desconocido y queda escrito.
- UI: `suggest.test.ts` (qué hay bajo el cursor, orden, qué escribe), el
  compositor (teclado, ratón, Escape, foco), el medidor y compactar, los avisos
  (cuándo, qué dicen, ráfagas, apagados) y el interruptor de Ajustes.
