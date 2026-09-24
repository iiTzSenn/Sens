# Revisión de mantenimiento y evolución de Sens

## Diagnóstico

Sens ya tiene tres capas: indexador y CLI en TypeScript, motor del agente en
Rust y aplicación de escritorio en Tauri. La interfaz usaba un único HTML de
7.740 líneas, con unos 6.000 renglones de JavaScript y 1.370 de CSS incrustados.
El problema principal de esa interfaz es la concentración de responsabilidades
y estado mutable, no utilizar JavaScript sin framework.

El streaming ya agrupa actualizaciones con `requestAnimationFrame` y conserva
bloques renderizados. No se ha medido su rendimiento ni se atribuye a esta
revisión una mejora de velocidad del chat. La búsqueda del catálogo sí hacía
varios recorridos y normalizaba los mismos nombres repetidamente.

## Cambios aplicados

- `ui/index.html` conserva la estructura; `ui/styles.css` contiene los estilos
  originales y `ui/app.js` inicia la aplicación como módulo ES.
- `ui/market-search.js` encapsula la búsqueda diferida y la clasificación del
  catálogo. Cada búsqueda descarta las respuestas y errores de peticiones
  previas, incluso al repetir el mismo texto. Los últimos resultados siguen
  visibles hasta que llega la respuesta nueva y se vacían al desactivar la
  búsqueda en skills.sh.
- La clasificación recorre la lista una vez y almacena los nombres normalizados
  en una caché débil asociada a los objetos del catálogo. Conserva la prioridad
  de coincidencias por nombre y el orden dentro de cada grupo.
- Las pruebas de identidad visual leen los recursos separados. Nuevas pruebas
  cubren búsquedas obsoletas, errores, filtros y clasificación.
- Se actualizaron dependencias dentro de los rangos existentes. `npm audit`
  pasó de 11 avisos a uno bajo en esbuild 0.27.7, dependencia de herramientas de
  desarrollo. `npm audit fix` no lo resuelve con el árbol actual; no se forzó un
  cambio de versión fuera de los rangos declarados.

## Elección del frontend

Recomendación para el crecimiento previsto: React con TypeScript y Vite,
manteniendo Tauri y Rust. React aporta componentes, composición y un modelo
de estado para gestionar chat, paneles, permisos y ajustes. TypeScript permite
comprobar los contratos del frontend. Ninguno sustituye el diseño del motor ni
garantiza por sí mismo un menor consumo de recursos.

Tauri acepta distintos frameworks y sirve recursos estáticos. React puede
incorporarse por partes. Para esta aplicación no se ha identificado una
necesidad de renderizado en servidor que justifique añadir Next.js.

Fuentes: [configuración de frontend de Tauri](https://v2.tauri.app/start/frontend/)
y [adopción incremental de React](https://react.dev/learn/add-react-to-an-existing-project).

La migración no se ha ejecutado en esta revisión. El archivo `app.js` sigue
siendo grande; extraerlo del HTML es un primer paso, no una arquitectura modular
terminada. La siguiente etapa debería:

1. Definir tipos para comandos y eventos entre Rust y la interfaz.
2. Introducir Vite y React en una vista acotada, por ejemplo ajustes.
3. Migrar catálogo, sesiones y explorador con estado propio por funcionalidad.
4. Migrar el chat preservando streaming, permisos, scroll, selección de texto y
   restauración de sesiones. Medir conversaciones largas antes de decidir
   virtualización u otras optimizaciones.

Cada región del DOM debe tener un único propietario durante la transición:
React o el código existente. Evitar que ambos modifiquen los mismos nodos.

## Proveedores

La lista de proveedores existe, pero solo declara Claude. `chat.rs` controla
directamente su proceso y protocolo; `providers.rs` conoce las credenciales y
variables de Anthropic. Cambiar de frontend no desacopla estas piezas.

Antes de integrar un segundo proveedor:

1. Separar el adaptador de Claude del control de sesiones y del contrato de
   eventos que consume la interfaz.
2. Definir operaciones de iniciar, enviar, detener, responder a permisos y
   cerrar, junto con capacidades declaradas por cada adaptador.
3. Identificar proveedor y modelo en sesiones persistidas; definir cómo se leen
   las sesiones antiguas de Claude.
4. Diferenciar adaptadores de agentes CLI de APIs de modelos. Una API de modelo
   requiere implementar además el ciclo de herramientas, permisos y contexto;
   no equivale a sustituir el ejecutable de Claude Code.

El esquema concreto debe validarse con el segundo proveedor elegido para no
crear abstracciones que solo reflejen el comportamiento de Claude.

## Validación y límites

- Base inicial: 192 pruebas aprobadas.
- Después de los cambios: 204 pruebas aprobadas, comprobación de tipos y
  compilación del CLI/indexador correctas.
- Sintaxis de los módulos de UI comprobada con Node y grafo de importaciones
  empaquetado en memoria con esbuild para navegador.
- No se ejecutaron pruebas Rust, compilación Tauri ni comprobaciones visuales
  de la aplicación nativa: Cargo no está disponible en el PATH del entorno.
- El frontend continúa sin comprobación completa de tipos; las pruebas de
  Node no sustituyen una prueba integrada de la aplicación de escritorio.
- La revisión se centró en estructura del frontend, catálogo y acoplamiento
  con proveedores. No constituye una auditoría exhaustiva del motor Rust.

También queda por corregir la compatibilidad anunciada con Node 18: las
dependencias actuales de Commander y Globby requieren versiones posteriores.
Debe elegirse un mínimo soportado y comprobarlo en CI antes de publicar.
