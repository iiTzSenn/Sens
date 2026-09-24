# Temas: modo y acento

Fecha: 2026-09-24 · Ámbito: `src/brand/tokens.ts`, `docs/brand/identity.md`
(§3.8), `rust/sens-app/ui` (`shared/tokens.css`, `shared/look.ts`,
`shared/look.css`, `shared/LookPicker.tsx`, `shared/stone.ts`,
`features/chat/grain.ts`, `features/composer/Knobs.tsx`,
`shared/syntax/tokenize.ts`, `features/settings/`, `setup/`),
`rust/sens-app/src` (`look.rs`, `main.rs`), `rust/sens-setup/src` (`look.rs`,
`install.rs`, `layout.rs`, `window.rs`).

## Tarea del usuario

Elegir cómo se ve Sens: oscuro, claro o como Windows, y el color que toma
Signal. Elegirlo al instalar, verlo al instante en todo — la piedra, el «sens
AI» del chat vacío, los píxeles del esfuerzo máximo, el borde de un compositor
que trabaja — y cambiarlo después en unos Ajustes que ya no ocupan la ventana,
sino una hoja sobre ella, como Claude Desktop.

Acción focal del paso nuevo del instalador: «Instalar Sens». De Ajustes ›
Apariencia: elegir, sin botón de guardar.

## Decisiones

- **Un aspecto son dos elecciones independientes.** Modo (`dark`, `light`,
  `system`) y acento (`signal`, `ice`, `iris`, `rose`, `neutral`). Se combinan
  libremente: 15 aspectos con un solo conjunto de reglas.
- **El acento sustituye a Signal y a nada más.** Hereda sus significados, sus
  restricciones y su 5 %. Los colores funcionales no cambian con él; por eso no
  hay acentos verdes, ámbar, naranjas ni rojos: «trabajando» y «hecho» se
  leerían como «éxito», «esperando» o «peligro».
- **Cada acento tiene la rampa de Signal**, dibujada en OKLCH a su tono
  (100, 200, 500, 600, 700, 800, tint-900, tint-700). Signal gana el 800: el
  700 del documento de identidad solo daba 2,5:1 sobre Bone, y el modo claro
  necesita un acento legible como texto y como anillo de foco.
- **La interfaz nunca nombra una rampa, solo roles.** `--focus`,
  `--accent-fill`, `--accent-ink`, `--tint`, `--glow`, `--grain-1..3`… Los
  resuelve `tokens.css` a partir de `data-mode` y `data-accent` en `<html>`.
  Un test impide `var(--sens-signal-…)` fuera de los tokens.
- **El modo claro sigue §3.4 de la identidad, corregido para AA.** Texto
  secundario `alloy-600` (nuevo), bordes fuertes `bone-300` (nuevo), estados
  con variantes `-700` legibles sobre Bone, botón principal carbón con texto
  papel. Signal en claro rellena con 600 y marca con 800.
- **El código usa Light+ en claro y Dark+ en oscuro, a la vez.** Shiki
  tokeniza con los dos temas y cada estilo lleva `light-dark(claro, oscuro)`;
  `color-scheme` en `:root` decide. Cambiar de modo no vuelve a colorear nada.
- **La piedra sigue siendo carbón en los dos modos.** Es la variante principal
  de la marca (cuerpo carbón, corte Signal, sobre Bone). En claro su brillo se
  queda en el cuerpo: la luz sumada a una página clara se ve como neblina.
- **Sin destello al abrir.** Rust lee el aspecto antes de crear la ventana, le
  da el fondo y el tema de ese modo y deja el aspecto en
  `window.__SENS_LOOK__`; la página no se pinta hasta tener `data-mode`.
- **El paso del instalador solo sale en una instalación nueva e interactiva.**
  Una actualización, una reinstalación o una instalación pasiva no preguntan:
  usan el aspecto guardado, y la ventana del instalador ya se abre con él.
- **Ajustes es una hoja modal, hecha con las piezas de Sens.** Modal sí, pero
  no la de Claude Desktop (columna lateral con iconos, título grande,
  tarjetas con miniaturas): por dentro es una vista de Sens — cabecera con la
  etiqueta y una línea, pestañas sobre la regla como en la ficha de
  Capacidades, y en Apariencia la superficie destacada con la marca. Esc, el
  fondo o la X la cierran y el foco vuelve a quien la abrió. `Ctrl+,` la abre.
- **Del instalador a la app sin saltos.** La bienvenida sale desde el primer
  fotograma de una instalación nueva, la ventana de Sens no aparece hasta
  estar pintada, y el instalador no se cierra hasta verla.

## Modelo

```ts
type Mode = "dark" | "light" | "system";
type Accent = "signal" | "ice" | "iris" | "rose" | "neutral";
interface Look { mode: Mode; accent: Accent }   // por defecto { dark, signal }
```

`shared/look.ts` lo comparten la app y el instalador:

- `lookOf(valor)` acepta solo modos y acentos conocidos; lo demás cae al de
  por defecto, campo a campo.
- `showLook(look)` pone `data-mode` (ya resuelto: `system` mira
  `prefers-color-scheme`) y `data-accent` en `<html>` y avisa al almacén
  `look` (`{ chosen, shown }`).
- `followLook()` escucha a Windows mientras el modo es `system`; cuando cambia
  el modo elegido pone el tema de la ventana (`setTheme`, `null` para seguir a
  Windows) y cuando cambia el modo que se ve, su fondo (`setBackgroundColor`
  con `--ground`).

## Tokens

`tokens.css` tiene tres capas:

1. **Primitivas** `--sens-*`, las de `palette` en `tokens.ts` (un test exige
   que estén todas, con su valor).
2. **Rampa del acento** `--accent-100 … --accent-tint-700`, fijada por
   `[data-accent="…"]` (Señal también en `:root`). Neutro la arma con Bone,
   Alloy y Carbon.
3. **Roles**, fijados por `:root, [data-mode="dark"]` y `[data-mode="light"]`,
   con los mismos nombres en los dos (un test lo comprueba), más
   `[data-accent="neutral"][data-mode="light"]` para que Neutro rellene en
   carbón.

Como las reglas no se atan a `:root`, cualquier elemento puede llevar su
propio `data-mode` o `data-accent`: así las miniaturas de Ajustes enseñan el
modo oscuro, el claro y el de Windows a la vez, y cada muestra de color pinta
su acento.

La tabla de roles por modo está en la identidad, §3.8.

## Animaciones

| Qué | Antes | Ahora |
| --- | --- | --- |
| La piedra (`stone.ts`) | `SIGNAL` y `HOT` constantes del shader | uniforms; `StoneCanvas` los lee de `--glow` y `--glow-hot` (en luz lineal) al montar y al cambiar el acento. Uniform `ground`: en claro el brillo solo se suma sobre el cuerpo. |
| «sens AI» (`grain.ts`) | `--sens-signal-200/500/700` sobre `--sens-carbon-950` con `darken` | `--grain-1..3` sobre `--ground`; en claro las letras son carbón con `lighten` y el shader recorta con `min` en vez de `max`. Se rehace al cambiar modo o acento. |
| Píxeles del esfuerzo máximo (`Knobs.tsx`) | leía `--focus` al abrir | igual, y se redibuja al cambiar modo o acento |
| Órbita del compositor, brillo de un paso en curso, punto de sesión que trabaja, marca de la barra | Signal fijo en CSS | roles |
| Paso «Elige cómo se ve.» del instalador | — | la piedra repite *focus* con cada acento: el corte se enciende en el color nuevo |

## Instalador

Instalación nueva e interactiva:

1. **Portada** — «Instala Sens.» «Todo empieza con claridad.» El botón pasa a
   «Empezar →» (lleva al paso nuevo). «Personalizar instalación» sigue igual y
   su botón pasa a «Continuar →».
2. **Elige cómo se ve.** — «Sens se abrirá así. Puedes cambiarlo cuando
   quieras en Ajustes.» *Modo*: Oscuro, Claro, Sistema (radios con icono).
   *Color*, con el nombre del elegido al lado: cinco muestras. Toda la ventana
   cambia al elegir. «Instalar Sens →» y «Volver» (a la pantalla de la que
   vino).
3. Instalando, Listo, Error: como antes, ya en el aspecto elegido.

Contrato: `SetupState` gana `look: Look | null` (el guardado, si lo hay) y
`Choice` gana `look: Look | null` (solo en una instalación nueva e
interactiva). Tras registrar Sens en Windows, `install.rs` escribe
`%APPDATA%\dev.sens.desktop\look.json` con la línea «Guardando tu apariencia»;
si no puede, lo dice en el registro y la instalación sigue. La demo lo recorre
sin escribir. `Layout` gana `settings` (esa carpeta), que ya estaba en `data`.

En desarrollo: `setup.html?look=light.iris` simula un aspecto guardado.

## La app

- `look.rs`: `Look { mode, accent }` en `look.json` de la carpeta de datos.
  Uno que falta o está dañado es `{ dark, signal }`; un acento que no es una
  palabra en minúsculas pasa a `signal`. Comandos `look` y `set_look`.
- `main.rs`: la ventana se crea en `setup` desde su configuración
  (`"create": false`) con el tema y el fondo del modo y el script
  `window.__SENS_LOOK__ = {…}`. En `system` el fondo sale del tema de Windows.
- Capacidades: `core:window:allow-set-theme` y
  `core:window:allow-set-background-color`, en la app y en el instalador.
- `main.ts` llama a `showLook(lookOf(window.__SENS_LOOK__))` antes de pintar
  nada; hasta entonces `:root:not([data-mode]) body` no se muestra.
- `features/look/store.ts`: `chooseLook` enseña el aspecto al momento y lo
  guarda; si no se puede guardar, vuelve al anterior y Ajustes dice por qué.

## Ajustes

- `<dialog>` de 720 × 600 como máximo, centrada. Cabecera como `view-top`:
  «AJUSTES» en etiqueta y «Tu perfil, cómo se ve Sens y con quién trabaja.»;
  a la derecha la tecla `Esc` y el botón de cerrar con borde de Sens. Debajo,
  las pestañas General, **Apariencia** y Proveedores (`.tabs`, flechas,
  Inicio y Fin), sin iconos.
- Apariencia: la superficie destacada (`view-focus`, el tinte del acento) dice
  lo que hay ahora — «Claro · Iris» — y lleva la marca de Sens, cuyo corte se
  vuelve a trazar en el color elegido (1300 ms, el *focus* de la identidad;
  quieto con movimiento reducido). Debajo, los mismos controles que el
  instalador: *Modo* en tres segmentos con icono y *Color* en cinco muestras.
- La marca es un componente (`shared/Mark.tsx`) que usan la barra de la
  ventana, el respaldo sin WebGL de la piedra y esta superficie.
- La hoja se abre desde el menú del perfil, desde «Actualizar Claude Code» del
  selector de modelos (en Proveedores) y con `Ctrl+,`. Mientras está abierta,
  los atajos de la ventana no actúan y el panel web nativo se oculta, como con
  el diálogo.
- «Volver a verla» e «Importar de Claude Code» cierran la hoja antes de abrir
  la bienvenida.
- La vista de Ajustes a pantalla completa desaparece (`View` ya no tiene
  `settings`).

## Del instalador a la app

Antes, «Abrir Sens» cerraba el instalador al instante; la app tardaba en
aparecer, se pintaba vacía, enseñaba el chat y solo cuando llegaba el perfil
por IPC saltaba la bienvenida, con un fundido que dejaba ver la app debajo.

- Rust deja `window.__SENS_WELCOMED__` junto al aspecto; `greetAtStart()`
  abre la bienvenida antes del primer render y sin fundido (`data-still`).
  Cuando llega el perfil, `greetIfNew()` no la reinicia: solo rellena el
  nombre si sigue vacío.
- La ventana se crea oculta y centrada (`"visible": false, "center": true`);
  la página la enseña tras dos fotogramas (`core:window:allow-show`) y Rust la
  enseña a los 4 s si la página no lo hizo.
- `setup_launch` abre Sens y espera hasta 8 s a que tenga una ventana visible
  (`running::shown`). Mientras, el botón dice «Abriendo Sens…», «Cerrar» se
  desactiva y la piedra hace *scan*. Si no puede abrirla, lo dice bajo los
  botones y no se cierra. Al volver de una actualización pasa lo mismo.

## Pruebas

- `test/brand.test.ts`: cada acento con su rampa entera y sus primitivas; la
  interfaz ofrece exactamente los acentos de la marca; los mismos roles en
  claro y oscuro; ninguna rampa fuera de los tokens; la página oculta hasta
  saber su modo.
- `shared/look.test.ts`: `lookOf`, `system` siguiendo a Windows, `showLook`,
  la conversión a luz lineal.
- `setup/Setup.test.tsx`: el paso nuevo, «Volver» a la pantalla de origen, la
  elección que llega a `setup_install`, una reinstalación que abre en el
  aspecto guardado y no pregunta.
- `settings/Settings.test.tsx`: la hoja abre en la sección pedida, las
  flechas cambian de pestaña y el foco vuelve al cerrar; elegir guarda y enseña
  «Claro · Rosa»; un fallo vuelve al aspecto anterior y lo dice.
- `welcome/Welcome.test.tsx`: con `__SENS_WELCOMED__ = false` la bienvenida
  está desde el principio, quieta, y el perfil que llega después no la
  reinicia.
- `syntax.test.ts`, `markdown.test.tsx`: colores `light-dark(Light+, Dark+)`.
- `setup/Setup.test.tsx` también: «Abriendo Sens…» hasta que Sens está en
  pantalla, y el motivo cuando no se puede abrir.
- Rust: `look.rs` en las dos crates; la instalación escribe el aspecto elegido
  y deja el guardado cuando no se eligió ninguno; `profile::script`;
  `running::shown` deja de esperar a una app que nadie ejecuta.

## Fuera de alcance

- Acentos a medida (un selector de color libre): cada acento necesita su
  rampa comprobada.
- Un paso de aspecto en la bienvenida de la app: quien actualiza ya tiene su
  aspecto (el de siempre) y lo cambia en Ajustes.
- Buscar dentro de Ajustes: con tres secciones no hace falta.
- macOS y Linux.
