# Ajustes y proveedores

Fecha: 2026-09-23 · Ámbito: `rust/sens-agent` (`process.rs`, `account.rs`),
`rust/sens-app` (`providers.rs`, `main.rs`, `ui/index.html`). Implementado.

## Decisiones

- Ajustes deja de ser un diálogo y pasa a ser una vista, con secciones **General**
  (el nombre) y **Proveedores**. Se abre desde el menú del perfil; «Conectar Claude
  Code…» del selector de modelos abre Ajustes › Proveedores.
- «Conectar manualmente» Claude Code significa gestionar su sesión y, si se quiere,
  entrar con una clave de API. No se elige la ruta del ejecutable: sigue siendo
  `claude` del PATH.
- Sens sigue sin tocar credenciales de la suscripción: el inicio y el cierre de
  sesión los hace el propio `claude` (`auth login --claudeai|--console`,
  `auth logout`).

## Cómo entra Claude Code

| Método | Qué hace Sens |
| --- | --- |
| Suscripción de Claude | «Iniciar sesión» abre `claude auth login --claudeai` en una ventana |
| Consola de Anthropic | «Iniciar sesión» abre `claude auth login --console` |
| Clave de API | guarda la clave cifrada y la pasa como `ANTHROPIC_API_KEY` |

- `providers.json` en la carpeta de datos: `{ "claude": { "method", "sealedKey" } }`.
  La clave se cifra con DPAPI (`CryptProtectData`, ligado al usuario de Windows) y
  nunca vuelve a la UI: solo `keyHint` (`sk-ant-…WXYZ`). Solo se aceptan claves que
  empiezan por `sk-ant-`. Elegir «Clave de API» sin clave guardada no persiste nada:
  solo muestra el campo.
- Con «Clave de API» elegida, **todos** los `claude` que lanza Sens la llevan:
  `sens_agent::process::claude()` construye el comando con el entorno que el host
  fija con `process::set_environment` (al arrancar y en cada cambio), y el chat la
  recibe en `Settings.env`, así que cambiar de método reinicia su proceso en el
  siguiente mensaje. Claude Code la reconoce: `auth status` dice
  `apiKeySource: "ANTHROPIC_API_KEY"`, y la UI lo muestra como «Conectado con clave
  de API» sin el aviso naranja.

## Contrato

| Comando | Firma JS | Devuelve / efecto |
| --- | --- | --- |
| `providers_state` | `invoke("providers_state")` | `[{ id, vendor, label, method, keyHint, version, account, error }]` |
| `set_provider_method` | `invoke("set_provider_method", { id, method })` | `null`; `apiKey` sin clave es error |
| `save_api_key` | `invoke("save_api_key", { id, key })` | `null`; deja el método en `apiKey` |
| `forget_api_key` | `invoke("forget_api_key", { id })` | `null`; si estaba en `apiKey`, vuelve a `subscription` |
| `provider_sign_in` | `invoke("provider_sign_in", { method })` | `null`; abre la ventana de login |
| `provider_sign_out` | `invoke("provider_sign_out")` | `null` |

`claude_sign_in` desaparece. `providers_state` recorre `catalog::PROVIDERS`, así
que un proveedor nuevo es una entrada más ahí y su tarjeta sale sola.
