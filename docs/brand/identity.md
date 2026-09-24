# Sens — Visual Identity System

Version 0.1 · Working direction: The Cut

This document is the source of truth for anyone — human or AI — designing Sens
interfaces, assets, documentation, terminal output, illustrations, motion, or
marketing material.

## 1. Brand idea

Sens helps an AI understand more code while reading less of it. Its identity
must communicate:

- **Reduction** — remove noise, duplication, and unnecessary context.
- **Precision** — find the relevant symbol, dependency, or path directly.
- **Clarity** — expose structure without overwhelming the user.
- **Quiet intelligence** — capable without appearing magical, loud, or theatrical.
- **Evidence** — report what was found and measured rather than making vague claims.

The visual concept is **The Cut**: a compact dark form divided by one precise
S-shaped incision. The body represents a dense codebase; the cut represents the
shortest path through it. The incision also creates the letter S through
negative space.

The symbol is not a coffee bean, planet, eye, yin-yang, or generic AI orb. Never
add literal details that make it one of those objects.

## 2. Brand personality

Sens is:

- exact, calm, observant, economical, technical, confident;
- tactile enough to feel distinctive, but structurally minimal;
- friendly through clarity, not through cartoon expressions;
- premium through restraint, not through decoration.

Sens is not:

- futuristic neon cyberpunk;
- a cute robot or humanoid assistant;
- mystical, mythological, cosmic, or magical;
- corporate blue SaaS;
- noisy, gamified, playful, or excessively animated.

When two design options work equally well, choose the one with fewer elements,
fewer colors, less copy, and clearer hierarchy.

## 3. Core color system

### 3.1 Brand primitives

| Token | Hex | RGB | Role |
| --- | --- | --- | --- |
| carbon-950 | `#0C0D0D` | 12, 13, 13 | Deepest backgrounds, app shell |
| carbon-900 | `#111313` | 17, 19, 19 | Primary dark surface and logo body |
| carbon-800 | `#1A1D1C` | 26, 29, 28 | Elevated panels |
| carbon-700 | `#252927` | 37, 41, 39 | Borders and interactive surfaces |
| carbon-600 | `#363B38` | 54, 59, 56 | Strong borders, disabled controls |
| alloy-600 | `#595F5C` | 89, 95, 92 | Secondary text on light surfaces |
| alloy-500 | `#747B77` | 116, 123, 119 | Tertiary text on light surfaces |
| alloy-400 | `#929995` | 146, 153, 149 | Secondary text on dark surfaces |
| alloy-300 | `#B5BBB7` | 181, 187, 183 | Tertiary light content |
| bone-300 | `#D1CFC8` | 209, 207, 200 | Strong borders on light surfaces |
| bone-200 | `#DDDCD5` | 221, 220, 213 | Dividers on light surfaces |
| bone-100 | `#ECEAE3` | 236, 234, 227 | Secondary light surface |
| bone-50 | `#F4F1EA` | 244, 241, 234 | Primary light background |
| paper | `#FBFAF6` | 251, 250, 246 | Highest light surface |
| signal-800 | `#4E700D` | 78, 112, 13 | Signal as text, focus and indicators on light surfaces |
| signal-500 | `#C7FF4A` | 199, 255, 74 | Brand signal / active intelligence |
| signal-600 | `#A9E52D` | 169, 229, 45 | Signal on light backgrounds |
| signal-700 | `#78AA12` | 120, 170, 18 | Signal text on very light surfaces |
| signal-200 | `#E4FFA5` | 228, 255, 165 | Soft signal highlight |
| signal-100 | `#F0FFD0` | 240, 255, 208 | Light signal wash |
| signal-tint-900 | `#1A1F16` | 26, 31, 22 | Featured dark surface: Carbon with a trace of Signal |
| signal-tint-700 | `#353E2A` | 53, 62, 42 | Edge of the featured dark surface |

The brand should be approximately 85% neutral, 10% typography/data tones, and at
most 5% Signal. Signal is scarce by design.

### 3.2 Meaning of Signal

Signal green means only one of the following:

- Sens is actively scanning or focusing.
- Sens found a relevant result.
- An optimization or operation completed successfully.
- An element is currently selected because it is the object of analysis.
- The S-shaped cut in the core brand mark.

Never use Signal:

- as a large page background;
- for ordinary body text;
- for every button, icon, link, badge, or chart series;
- merely to make a composition feel more colorful;
- simultaneously on many unrelated objects;
- for warnings or neutral information.

If everything is Signal, nothing is Signal.

### 3.2.1 Signal tint

The tint tokens are Carbon carrying roughly 5% of Signal. They are not Signal
and carry none of its meanings; they mark the one surface on a screen that
summarizes the state of what the user is looking at.

- Use `signal-tint-900` as the background and `signal-tint-700` as the 1 px
  edge of a single featured surface per screen.
- Never use the tint for page backgrounds, whole panels, rows, buttons, or
  more than one surface at a time.
- Text on the tint follows the dark theme text tokens; Signal on top of the
  tint keeps its usual restrictions.
- The tint is dark-theme only. The light theme uses signal-100 for the same role.

### 3.3 Functional colors

Functional status colors are separate from the brand accent.

| Token | Hex | Use |
| --- | --- | --- |
| success | `#43C878` | Confirmed successful system operation when Signal would cause ambiguity |
| warning | `#E7B84B` | Review required, medium-confidence dead code |
| danger | `#E7655F` | Error, destructive action, high-risk condition |
| info | `#6FA7D8` | Neutral informational state and external reference |

Status colors must not dominate the interface. Use a colored icon, 1–2 px edge,
small badge, or compact highlight — not a saturated full card unless urgency
requires it.

For dead-code confidence:

- high-confidence removable candidate: success;
- medium-confidence candidate: warning;
- low-confidence / verify first: danger;
- do not invert these meanings merely to follow conventional severity rankings.

On light surfaces the four tones above fall under 3:1 as text. The light
theme uses their deep variants for text, icons and edges — `success-700`
`#11733E`, `warning-700` `#895B00`, `danger-700` `#B63132`, `info-700`
`#2E6B9C`, each at least 4.5:1 on bone — and keeps the bright ones for fills
with carbon text (a destructive button, the window's close control).

### 3.4 Light theme

- Page background: bone-50.
- Primary surface: paper.
- Elevated/secondary surface: bone-100.
- Interactive surface and selection: bone-200.
- Primary text: carbon-950.
- Secondary text: carbon-600; muted text: alloy-600; tertiary: alloy-500.
- Hairline/divider: bone-200; strong border: bone-300; edge: alloy-300.
- Active selection: signal-100 background with signal-800 foreground.
- Primary dark button: carbon-900 background, paper text.
- Signal button is reserved for the single key analysis action on a view; on
  light it fills with signal-600 and keeps carbon text.
- The mark keeps its carbon body; only the page around it turns light.

Avoid pure white `#FFFFFF` across large areas. Bone creates a quieter, more
physical identity.

### 3.5 Dark theme

- Page background: carbon-950.
- Primary surface: carbon-900.
- Elevated surface: carbon-800.
- Interactive surface: carbon-700.
- Primary text: bone-50.
- Secondary text: alloy-400.
- Divider: carbon-700.
- Active selection: carbon-700 background plus a small signal-500 indicator.
- Primary button: bone-50 background, carbon-950 text.

Do not render long text in Signal on dark backgrounds. Use it for short labels,
icons, values, cursor states, and the brand incision.

### 3.6 Contrast and accessibility

- Body text must target WCAG AA contrast: at least 4.5:1.
- Large text and meaningful icons must reach at least 3:1.
- Never communicate state by color alone. Pair it with an icon, label, pattern, or position.
- signal-500 is not suitable for small text on bone-50; use signal-800
  (signal-700 reaches only 2.5:1).
- Avoid alloy-500 for tiny text on dark backgrounds; use alloy-400 or lighter.
- Focus rings: 2 px of the accent's 500 on dark UI; 2 px of its 800 on light UI.

### 3.7 Code syntax colors

One exception to 3.1 and to the rule against a rainbow palette: code shows
the colors of VS Code's Dark+ theme, and of Light+ in the light theme, so a
keyword, a string, a type or a comment reads as it does in the editor the user
already knows. Coloring by grammar is a functional need: it tells structure at
a glance, and a palette of our own would have to be learned. Each token
carries both colors as `light-dark()`, so a change of mode repaints code
without coloring it again.

- The grammars are VS Code's own TextMate grammars, through Shiki; GitHub
  Linguist decides which language a file is, by its name, extension or
  shebang. Anything without a grammar stays plain.
- They color code and nothing else: the file viewer, code blocks in the chat,
  and diffs (removed lines read as the file before, the rest as the file
  after). Paths, logs and machine output stay mono in Alloy.
- Plain text keeps the surface's own text token; only tokens a grammar names
  take a theme color. Backgrounds stay Carbon, or Bone in the light theme: the
  theme's own is not used.
- The theme's colors are not edited, and Signal never appears among them.
- The table is generated from the installed packages with
  `npm run languages -w sens-app-ui`. Upgrade shiki or linguist-languages,
  then regenerate.

### 3.8 Themes: mode and accent

A person chooses how Sens looks — in the installer the first time, and in
Ajustes › Apariencia afterwards. A look is two independent choices:

- **Mode**: Oscuro (the default and the brand's own), Claro, or Sistema, which
  follows Windows and changes with it.
- **Accent**: the color Signal takes. Señal (`signal`, the default), Hielo
  (`ice`), Iris (`iris`), Rosa (`rose`) or Neutro (`neutral`).

The accent replaces Signal and nothing else. It inherits every meaning and
every restriction of 3.2 — scanning, focus, a relevant result, confirmed
completion, the S cut — and the 5% budget. Functional colors (3.3) never
change with it; that is why no accent sits near their hues: a green, amber,
orange or red accent would make "working" and "done" read as "success",
"waiting" or "danger".

Each colored accent has the same ramp as Signal, drawn in OKLCH at its own
hue so the stops carry the same weight:

| Stop | Signal | Ice | Iris | Rose | Role |
| --- | --- | --- | --- | --- | --- |
| 100 | `#F0FFD0` | `#E9FBFF` | `#F7F5FF` | `#FFF3F7` | Hot core of the lit cut; light featured surface |
| 200 | `#E4FFA5` | `#CCF5FF` | `#EDEAFF` | `#FFE5EF` | Text on the dark featured surface; light featured edge |
| 500 | `#C7FF4A` | `#4EE1FF` | `#B6A2FF` | `#FF8ABE` | The accent on dark; the glow of the cut in both modes |
| 600 | `#A9E52D` | `#00C9E9` | `#A184F7` | `#ED69A8` | Hover on dark; accent fills on light |
| 700 | `#78AA12` | `#009BB4` | `#836CCA` | `#C15588` | Link underline and shimmer edge on dark |
| 800 | `#4E700D` | `#007082` | `#665798` | `#914669` | The accent on light: focus, indicators, short text (≥ 4.5:1 on bone) |
| tint-900 | `#1A1F16` | `#131F22` | `#1D1C25` | `#241A1E` | Featured dark surface |
| tint-700 | `#353E2A` | `#243F45` | `#3B374B` | `#49333C` | Edge of the featured dark surface |

Carbon text reaches at least 6.6:1 on every 500 and 600. Neutro builds its
ramp from Bone, Alloy and Carbon: the cut glows bone, fills are bone on dark
and carbon on light.

Interfaces never name a ramp. They use roles, which the tokens resolve for the
chosen mode and accent:

| Role | Dark | Light |
| --- | --- | --- |
| `--focus` | 500 | 800 |
| `--accent-text` | 600 | 800 |
| `--accent-soft` | 200 | 800 |
| `--accent-line` | 700 | 600 |
| `--accent-fill` / `--accent-fill-hover` | 500 / 600 | 600 / 500 |
| `--accent-ink` | carbon-950 | carbon-950 (paper for Neutro) |
| `--tint` / `--tint-edge` | tint-900 / tint-700 | 100 / 200 |
| `--glow` / `--glow-hot` | 500 / 100 | 500 / 100 |
| `--glint-edge` / `--glint-peak` | 700 / 200 | 800 / 600 |
| `--grain-1..3` | 200, 500, 700 | 600, 700, 800 |

Motion follows the accent: the lit cut of the stone, the grain inside the
empty chat's "sens AI", the pixels of maximum effort, the orbit of a working
composer and the shimmer of a live step all draw in the chosen accent. In the
light theme the stone keeps its carbon body and its shadow; its glow stays on
the body, since light added to a bone page reads as haze.
## 4. Logo and symbol

### 4.1 Construction

The core symbol consists of:

- one compact rounded body in Carbon;
- one continuous S-shaped cut;
- two resulting masses that remain visually balanced;
- no internal nodes, eyes, sparkles, code brackets, or secondary marks.

The silhouette should feel engineered but not perfectly mechanical. Corners are
softened; the cut is precise. In flat applications the body is solid. Tactile
texture belongs only to large editorial renders.

### 4.2 Variants

- **Primary**: Carbon body with Signal cut on Bone.
- **Dark UI**: Bone or Carbon-raised body with Signal cut.
- **One color**: solid silhouette with the cut represented as negative space.
- **Micro mark**: simplified cut with increased optical width for 16–24 px.
- **Wordmark**: symbol followed by lowercase `sens`.

Never use glow in the production vector logo. A subtle glow may appear during an
active animated state, no larger than 1.5 times the width of the cut.

### 4.3 Clear space and minimum size

- Clear space around the mark: at least the width of the mark's central cut multiplied by 4.
- Minimum digital size: 16 px for the micro mark, 24 px for the primary symbol.
- Minimum wordmark width: 72 px.
- At small sizes, remove texture and increase the cut thickness; never add detail.

### 4.4 Prohibited treatments

Do not:

- rotate, skew, outline, bevel, or place the logo inside another arbitrary shape;
- use blue-purple gradients;
- turn the cut into lightning;
- add a face or character limbs;
- combine it with network nodes;
- use drop shadows in flat UI;
- use more than one colored cut;
- stretch the symbol to fill a container.

## 5. Typography

### 5.1 Product typography

Preferred UI family: Geist Sans. Acceptable fallback stack:

```css
font-family: Geist, Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
```

Preferred code/data family: Geist Mono. Fallback:

```css
font-family: "Geist Mono", "SFMono-Regular", Consolas, monospace;
```

Use sans-serif for navigation, explanation, actions, headings, and normal
values. Use mono only for code, commands, paths, symbol names, IDs, timings,
token counts, and machine output. Do not make the entire interface monospace.

### 5.2 Type behavior

- Brand name is lowercase: `sens`.
- Product prose uses sentence case, never title case everywhere.
- Headings are compact, medium weight, and usually one line.
- Avoid ultra-bold display type; maximum normal heading weight is 650.
- Avoid excessive letter spacing. Uppercase micro-labels may use 0.08em tracking.
- Numeric metrics may use tabular figures.

Suggested UI scale:

| Role | Size / line height | Weight |
| --- | --- | --- |
| Display | 48/52 | 560 |
| H1 | 32/38 | 600 |
| H2 | 24/30 | 600 |
| H3 | 18/24 | 600 |
| Body | 15/23 | 400 |
| Small | 13/19 | 450 |
| Micro label | 11/16 | 600 |
| Code | 13/20 | 450 |

## 6. Iconography

### 6.1 Family

Lucide is the icon family, used as drawn. Do not mix it with Phosphor,
Heroicons, Tabler, Material Symbols, or a second set of any kind — two families
read as two products.

Sens has no icons of its own, and does not commission a set in advance. Draw an
exclusive icon only when a specific screen needs a specific meaning and Lucide
cannot carry it, and then draw only that one. A pack drawn ahead of need is a
set of decisions taken without a case to test them against, and it ages into
decoration.

When that case does arrive, the exclusive icon is built on Lucide's 24 px grid
with the same stroke and terminals, so it sits in a row beside the family
without looking imported. It may borrow the geometry of the S cut where that is
honest, but it never restates the logo: one mark per interface.

### 6.2 Format

Every icon ships as SVG — the Lucide set and the exclusive four alike. No PNG,
no icon font, no raster sprite, at any size.

The reason is behavior, not file size. An SVG takes its color from
`currentColor` and its size from the type scale, so one file serves Signal and
Alloy, active and dim, light and dark. A raster pack needs one asset per color
per theme, and the first state that lacks its variant gets answered by tinting
a neighbor — which is how Signal stops meaning one thing.

- Icons inherit color. Never write a hex inside an icon file.
- An exclusive icon is a derived asset: generate it with `npm run brand` like the mark, and edit the generator rather than the output.
- No `<style>` blocks, filters, gradients, or embedded rasters inside an icon.
- Strokes stay strokes. Do not convert them to outlines and fill them.

### 6.3 Size, stroke, and color

| Context | Size | Stroke |
| --- | --- | --- |
| Inline with body or small text | 16 | 1.5 |
| Buttons, toolbars, list rows, tree nodes | 20 | 1.5 |
| Section headers, empty states | 24 | 1.75 |
| Editorial and feature blocks | 32+ | 2 |

Lucide's default 2 px stroke is heavier than this identity wants below 24 px.
Set the stroke explicitly instead of accepting the default.

- The default icon color is the muted text token, not the primary one.
- Signal on an icon means what it means everywhere: scanning, focus, a relevant result, confirmed completion. One Signal icon per region, never a row of them.
- Status icons use the functional colors and still carry a label, shape, or position. Color alone is not a state.
- Minimum size is 16 px. Below that, use a label.
- Meaningful icons reach 3:1 contrast and carry an accessible name; decorative ones are hidden from assistive technology.

### 6.4 Prohibited

Do not:

- rotate or mirror a Lucide icon to invent a meaning it does not have;
- fill an outline icon to build a selected state — change color or background instead;
- place icons inside colored circles by default;
- use an emoji where an icon belongs;
- give one concept different icons across the CLI, the app, and the docs;
- draw an exclusive icon before a screen needs it, or for a meaning Lucide already carries.

### 6.5 File type icons

One exception to 6.1 and 6.2: a file shows the icon of its type — the Python
snake on `main.py`, the Markdown mark on `README.md`, npm on `package.json` —
in that icon's own colors. A file type is recognized faster by its logo than
by a generic page with a tint, and a code editor is expected to show them.

- They come from Material Icon Theme (MIT), the set VS Code users already
  know, matched by whole file name first and then by the longest extension.
  Anything unknown gets the theme's plain file.
- They identify files and nothing else: the file tree, search results, the
  changes panel. Actions, states and navigation stay Lucide, including acting
  on a file ("Leer", "Editar"): the icon there is the action, not the type.
- They are not edited, recolored or mixed with Lucide in one glyph. Folders
  keep their Lucide chevrons.
- The table is generated from the installed package with
  `npm run icons -w sens-app-ui`; the build copies only the icons it names,
  with the theme's license. Upgrade the package, then regenerate.
- 16 px in lists, the minimum size of 6.3.

## 7. Layout and components

Sens uses an 8 px spacing system with 4 px optical adjustments.

Preferred radii:

- keycaps (shortcut hints such as `Ctrl` `N`) and inline code chips: 4 px;
- controls and small cards: 8 px;
- primary panels: 12 px;
- modal/sheet: 16 px;
- pill only for filters, compact states, or counts — not every button.

Borders are normally 1 px. Shadows should be nearly invisible; hierarchy comes
from tone, spacing, and edges. Use generous negative space and avoid nested
cards when one divider is sufficient.

Every screen should have one obvious focal action, one dominant information
region, and minimal chrome.

A sheet over the window (Ajustes) is built from the same parts as a view, not
from another app's settings screen: a head with the micro label and one line
of description, tabs sitting on the head's rule, the `Esc` key shown as a
keycap beside a bordered close button, and at most one featured surface. If a card contains only a label and value, consider
plain aligned text before adding a container.

### Data visualization

- Neutral graph nodes use Alloy and Bone tones.
- The selected/relevant path uses Signal.
- Dead-code nodes use semantic status colors.
- External dependencies use a dashed boundary or hollow shape, not another arbitrary color.
- Dim unrelated graph edges aggressively when a path is selected.
- Never use a rainbow palette for categories that can be distinguished by shape, grouping, or labels.

## 8. Motion and agent states

Motion explains what Sens is doing. It must not merely entertain.

| State | Visual behavior | Color |
| --- | --- | --- |
| idle | The cut rests; optional 4–6 s low-amplitude pulse | Carbon/Bone |
| scan | A thin line travels once across the body | Signal |
| focus | The moving line resolves into the S cut | Signal |
| compare | Two short segments approach and align | Signal + Alloy |
| prune | An unnecessary fragment fades and spacing closes | Signal confirmation |
| done | One brief brightening, then stillness | Signal → neutral |
| warning | Cut pauses; compact amber marker appears | Warning |
| error | Cut breaks once; no shaking loop | Danger |

Durations:

- hover/focus: 120–160 ms;
- panel transition: 180–240 ms;
- analysis loop: 900–1400 ms, calm and continuous;
- success confirmation: under 600 ms;
- honor `prefers-reduced-motion`; replace movement with a static state change.

Do not use bouncing, confetti, elastic easing, perpetual rotation, or decorative
particles.

## 9. Voice and microcopy

Sens speaks in concise, factual sentences. It does not role-play, congratulate
itself, or describe routine operations as magic.

Preferred vocabulary:

- scan, map, trace, find, compare, reuse, remove, verify, index, path, structure;
- found, reused, reduced, unchanged, needs review, not indexed.

Avoid:

- unleash, supercharge, revolutionize, magical, intelligent magic, thinking hard;
- emojis in core UI;
- exclamation marks for routine success;
- "Oops!" for errors;
- claims such as "perfect," "safe," or "optimized" without evidence.

Examples:

| Avoid | Use |
| --- | --- |
| AI is thinking... | Tracing dependencies… |
| Great! Optimization complete! | Noise removed · 14 symbols unchanged |
| Oops! Something went wrong. | Index unavailable · rebuild required |
| We found some dead code for you. | 8 dead-code candidates · 3 need review |
| Supercharge your codebase | Understand more. Read less. |

## 10. Terminal identity

The CLI must be more restrained than the dashboard.

```
sens › map

  indexed  128 files · 642 symbols · 84 ms
  focus    src/core.ts

sens ›
```

Rules:

- Prefix commands and agent output with `sens ›`.
- Use Signal only for `sens`, the current focus, and confirmed completion.
- Paths, counts, and timings use Alloy.
- Errors are one direct line in Danger; verbose detail appears only when requested.
- Spinner vocabulary must describe real work: indexing, tracing, comparing, verifying, pruning.
- No faces, emoji spinners, decorative banners, or large ASCII art by default.
- The S cut may become a 3–4 frame monochrome spinner if terminal support allows it.

## 11. Photography, illustration, and 3D

Most product communication should rely on UI, diagrams, typography, and the
symbol. When an editorial image is justified:

- use macro materials, precise cuts, dark matte surfaces, paper, graphite, glass, or anodized metal;
- use directional light and large quiet negative space;
- show one subject, not a collage of technology tropes;
- keep Signal as a small incision or reflection.

Never use humanoid robots, glowing brains, floating code, generic circuit
boards, galaxies, cyberpunk cities, or stock-photo developers looking at
holograms.

## 12. Design tokens

The canonical implementation lives in [`src/brand/tokens.ts`](../../src/brand/tokens.ts).
Every surface derives its CSS and terminal colors from that module; do not
retype these values by hand.

```css
:root {
  --sens-carbon-950: #0c0d0d;
  --sens-carbon-900: #111313;
  --sens-carbon-800: #1a1d1c;
  --sens-carbon-700: #252927;
  --sens-carbon-600: #363b38;
  --sens-alloy-500: #747b77;
  --sens-alloy-400: #929995;
  --sens-alloy-300: #b5bbb7;
  --sens-bone-200: #dddcd5;
  --sens-bone-100: #eceae3;
  --sens-bone-50: #f4f1ea;
  --sens-paper: #fbfaf6;
  --sens-signal-700: #78aa12;
  --sens-signal-600: #a9e52d;
  --sens-signal-500: #c7ff4a;
  --sens-signal-200: #e4ffa5;
  --sens-signal-100: #f0ffd0;
  --sens-signal-tint-900: #1a1f16;
  --sens-signal-tint-700: #353e2a;
  --sens-success: #43c878;
  --sens-warning: #e7b84b;
  --sens-danger: #e7655f;
  --sens-info: #6fa7d8;

  --sens-bg: var(--sens-bone-50);
  --sens-surface: var(--sens-paper);
  --sens-surface-subtle: var(--sens-bone-100);
  --sens-text: var(--sens-carbon-950);
  --sens-text-muted: var(--sens-alloy-600);
  --sens-border: var(--sens-bone-200);
  --sens-focus: var(--sens-signal-800);
}

[data-theme="dark"] {
  --sens-bg: var(--sens-carbon-950);
  --sens-surface: var(--sens-carbon-900);
  --sens-surface-subtle: var(--sens-carbon-800);
  --sens-text: var(--sens-bone-50);
  --sens-text-muted: var(--sens-alloy-400);
  --sens-border: var(--sens-carbon-700);
  --sens-focus: var(--sens-signal-500);
}
```

The desktop app's own tokens (`rust/sens-app/ui/src/shared/tokens.css`) add
the ramps of 3.8 and resolve the roles from two attributes the page carries on
`<html>`: `data-mode` (`dark` or `light`, already resolved from Sistema) and
`data-accent`. A new accent needs its ramp in `tokens.ts`, its rule in
`tokens.css` and its entry in `shared/look.ts`; the brand tests hold the three
together.

## 13. Instructions for Claude

When creating or modifying any Sens visual asset or interface:

1. Read this entire guide before proposing visual changes.
2. Begin by stating the user task and the single most important information/action on the screen.
3. Reuse the defined tokens. Do not invent another blue, purple, green, radius, shadow, or type scale unless a documented functional need exists. Code syntax colors are one (3.7); the accent ramps are another (3.8).
4. Style with roles (`--focus`, `--accent-fill`, `--tint`, `--primary`…), never with a ramp primitive such as `var(--sens-signal-500)`: a primitive ignores the look the person chose.
5. Keep Signal — whichever accent it takes — below roughly 5% of the visible composition.
6. Use Signal only for active intelligence, focus, relevant results, or confirmed completion.
7. Use semantic colors for warning, danger, success, and info; include a non-color cue.
8. Prefer spacing, typography, and tone over extra containers.
9. Remove decorative elements that do not explain state, structure, or action.
10. Preserve the S-cut symbol's silhouette and negative space. Never reinterpret it as a generic network, spark, bot, eye, or lightning bolt.
11. Use Geist Sans for product language and Geist Mono only for code/data.
12. Take icons from Lucide, as SVG, with an explicit 1.5 px stroke below 24 px. Draw an exclusive one only when a screen needs a meaning Lucide does not carry. File type icons are the one exception (6.5).
13. Write concise factual copy in sentence case.
14. Check light and dark variants, at least two accents (Señal and Neutro show the extremes), keyboard focus, reduced motion, and text contrast.
15. At the end, explain any deliberate exception to this guide. If there is no exception, say: Sens identity tokens preserved.

### Compact prompt block

Use this block when Claude cannot read the full guide:

> Design for Sens, a quiet code-intelligence engine whose promise is "Understand
> more. Read less." Use the "S Cut" identity: compact Carbon forms, warm Bone
> surfaces, and a scarce electric Signal green that means only scanning, focus,
> relevant findings, or confirmed completion. Keep the composition at least 85%
> neutral and Signal under roughly 5%. Use Geist Sans for UI and Geist Mono only
> for code/data. Take icons from Lucide, as SVG, and draw an exclusive one only
> when Lucide cannot carry the meaning. Favor negative space, one focal
> action, thin borders, minimal shadows, sentence case, concise factual copy,
> and functional motion. Do not use generic node-network logos, sparkles,
> robots, brains, blue-purple AI gradients, cyberpunk imagery, excessive glow,
> emoji, icon fonts, raster icon packs, decorative cards, or marketing hype.
> Functional states use distinct success, warning, danger, and info colors plus
> non-color cues. Support light/dark themes, AA contrast, keyboard focus, and
> reduced motion.

## 14. Decision test

Before approving a Sens design, answer:

1. Does the design help the user find the relevant thing faster?
2. Is Signal communicating meaning or merely decorating?
3. Could one element, color, card, line, or sentence be removed?
4. Does the screen still feel recognizably Sens without the logo?
5. Is the hierarchy obvious in three seconds?
6. Are claims backed by a visible count, path, status, or result?
7. Does the design work in one color and at small size?

If the answer to the third question is yes, remove that element and test again.
