# Novedades tras actualizar

Fecha: 2026-09-25 · Ámbito: `rust/sens-app` (`news.rs`, `profile.rs`, `update.rs`,
`main.rs`), `ui/src/features/news/`, `ui/src/app/session.ts`. Implementado.

## Decisiones

- La primera vez que Sens abre en una versión nueva enseña qué trae, como VS Code:
  una vista *Novedades* sobre el chat, al nivel de *Capacidades* y *Artefactos*.
  Se cierra con el ✕ o con «Continuar» y no vuelve hasta la versión siguiente.
- El texto son las notas de la release de GitHub, las mismas que ya enseña el panel
  de actualizar. No hay un changelog aparte que escribir en cada versión.
- Si alguien se salta versiones (de la 0.19.0 a la 0.21.0), ve todas las que no
  había visto, de la más nueva a la más vieja.
- Una instalación nueva no la ve: termina la bienvenida y esa versión ya cuenta
  como vista. Quien viene de una versión anterior a esta función ve solo la
  instalada.

## Qué se enseña

`news::since(seen)` pide la misma lista que el actualizador
(`releases?per_page=20`) y se queda con las releases que no son borrador ni
prerelease y cuya versión es mayor que `seen` y no mayor que la instalada. Si
`seen` está vacío, no se lee o no es anterior a la instalada, solo la instalada.

De cada una:

- `title`: el nombre de la release sin la etiqueta del principio
  (`v0.19.2 — Sens keeps answering` → `Sens keeps answering`). Vacío si no queda
  nada; la vista pone entonces «Sens X».
- `notes`: el cuerpo hasta la primera alerta de GitHub (`> [!…`) o el primer
  encabezado `Install`. Lo de después (el aviso de instalador sin firmar, cómo
  instalar, el SHA-256) sirve para descargar, no a quien ya actualizó.
- `page` y `published`: la página de la release y su fecha.

## Cuándo

- `profile.json` guarda `seen`: la última versión cuyas novedades se vieron.
- `Profile::owes_news(versión)`: `welcomed` y la versión es mayor que `seen`
  (un `seen` vacío cuenta como menor).
- Rust lo inyecta antes del primer fotograma junto a la bienvenida:
  `window.__SENS_NEWS__ = true|false`. `newsAtStart()` abre la vista en ese mismo
  fotograma, sin enseñar antes el chat.
- `boot()` abre el último proyecto debajo sin quitar la vista: `visit()` ya no
  vuelve al chat por su cuenta; lo hacen `draft`, `resume` y `openBeside`, que son
  lo que dispara quien usa Sens.
- `seen` pasa a la versión instalada cuando las notas llegan y se enseñan, o al
  cerrar la vista si no llegaron. Sin red, la vista lo dice y ofrece «Reintentar» y
  «Ver en GitHub»; si no se cierra, lo intenta otra vez al abrir Sens.

## Contrato

| Comando | Firma JS | Devuelve / efecto |
| --- | --- | --- |
| `news` | `invoke("news")` | `[{ version, title, notes, page, published }]`, de la más nueva a la más vieja |
| `saw_news` | `invoke("saw_news")` | `null`; guarda la versión instalada como vista |
| `set_welcomed` | `invoke("set_welcomed", { on })` | con `on`, además, la versión instalada cuenta como vista |

`profile` devuelve también `seen`.

## Interfaz

- Cabecera de vista: la etiqueta «Novedades», una línea («Lo que trae Sens X.» o
  «…, y N versiones anteriores que no habías visto.») y el ✕.
- Cada versión: el número en mono, «Instalada» en la que está corriendo, la fecha
  y «Ver en GitHub»; el título; las notas con `Markdown`, con los `###` como
  etiquetas de sección.
- Al final, «Continuar», que vuelve al chat.
- *Ajustes › General › Actualizaciones* tiene «Ver novedades», que la abre en
  cualquier momento sin tocar `seen`.
- En el navegador, `?news` la abre con notas de ejemplo.

## Pruebas

- `news.rs`: rango de versiones y orden, borradores y prereleases fuera, sin
  `seen` solo la instalada, el título sin la etiqueta, las notas cortadas en la
  alerta o en `Install` (y no en `Installer`). En vivo, `#[ignore]`: `the_real_news`.
- `profile.rs`: `owes_news` por versión, perfiles anteriores a `seen`, nada antes
  de la bienvenida, `saw_news` y `set_welcomed` guardan la versión instalada y el
  script inyectado.
- UI: abre desde el primer fotograma y cuenta como vista al enseñarse; no abre sin
  nada nuevo; cerrarla tras un fallo la da por vista; reintentar; abierta a mano no
  toca `seen`; una sola lectura; versión sin título ni notas; sin notas publicadas;
  «Ver en GitHub»; «Ver novedades» en Ajustes; `boot()` deja la vista donde está.

## Fuera de alcance

Un interruptor para no enseñarla nunca, notas traducidas al español, y guardarlas
en el momento de actualizar para leerlas sin red.
