# Sens: contraste con Ponytail y propuesta de evolución

Fecha: 2026-09-22. Estado: dirección aprobada; primer incremento implementado y verificado localmente.

## Objetivo

Sens debe ser un agente de escritorio capaz de resolver tareas completas con código sencillo, funcional y robusto. Reducir código significa evitar trabajo innecesario, reutilizar soluciones adecuadas y simplificar sin recortar requisitos. No significa minimizar líneas a cualquier precio.

La selección debe hacerse en dos pasos: primero descartar soluciones que incumplan requisitos o garantías; después comparar claridad, complejidad, reutilización, mantenimiento y tamaño. Ninguna puntuación de brevedad puede compensar una regresión funcional. Las comprobaciones aportan evidencia limitada, no una demostración universal de corrección.

## Qué aporta Ponytail

Su [skill principal](https://github.com/DietrichGebert/ponytail/blob/main/skills/ponytail/SKILL.md) propone comprender el flujo antes de elegir una solución, buscar reutilización y aprovechar biblioteca estándar, plataforma y dependencias instaladas. También pide corregir causas y conservar validaciones, protección de datos, seguridad, accesibilidad y requisitos explícitos.

Adoptaría esos principios. Adaptaría la preferencia por una línea, la reducción de alcance sugerida en algunos modos y la restricción de pruebas: en Sens mandan el contrato de la tarea y las convenciones del proyecto. Reutilizar tampoco justifica acoplar módulos incompatibles.

La [revisión de Ponytail](https://github.com/DietrichGebert/ponytail/blob/main/skills/ponytail-review/SKILL.md) busca sobreingeniería y deja corrección, seguridad y rendimiento fuera de su alcance. Sens necesita ambas revisiones, aunque una misma llamada al modelo pueda realizarlas cuando el cambio sea pequeño.

Su [benchmark publicado](https://github.com/DietrichGebert/ponytail/blob/main/benchmarks/results/2026-06-18-agentic.md) informa de una reducción media del 54 % de líneas en doce tareas, con Haiku 4.5 y cuatro ejecuciones por condición. No ejecuta las interfaces de esas tareas; las comprobaciones adversarias corresponden a otro conjunto. Es evidencia acotada y del propio proyecto, no prueba de equivalencia funcional general ni una expectativa transferible a Sens. No he reproducido esos resultados.

## Lo que hace hoy Sens

La revisión se apoya en el código del checkout, cuyo HEAD observado es `8179f8e`. El README tenía cambios locales previos que se han conservado. Se han leído módulos y pruebas existentes; no se han ejecutado tests ni llamadas a modelos.

| Área | Evidencia local | Consecuencia |
| --- | --- | --- |
| Contexto | `rust/sens-agent/src/context.rs`: mapa de hasta 120 líneas, hasta ocho candidatos por búsqueda basada en palabras y esquema del primer fichero mencionado | Orienta, pero no transmite las implementaciones que hay que preservar |
| Generación | `rust/sens-agent/src/model.rs`: API con un mensaje y sin herramientas; el preset CLI deshabilita Read, Grep y Glob, entre otras | No existe un ciclo de investigación controlado por Sens antes de devolver archivos completos; un comando personalizado puede comportarse de otra manera |
| Reparación | `repair()` en `rust/sens-agent/src/lib.rs` envía tarea, rutas y rechazo; las llamadas son independientes | El reintento no recibe explícitamente el briefing ni los contenidos de la propuesta rechazada |
| Duplicación | `gate/duplication.rs` compara nombres de símbolos introducidos con otros archivos | Coincidencia de nombre no demuestra duplicación; nombres distintos pueden ocultarla |
| Huérfanos | `gate/orphans.rs` y `gate/patch.rs` combinan índice y menciones por nombre | Es una señal útil, con límites para usos dinámicos y resolución contextual |
| Crecimiento | `gate/growth.rs` bloquea por encima de 40 líneas netas | Puede rechazar una solución necesaria o favorecer compactación y borrados que compensen adiciones |
| Verificación | `gate/trial.rs` selecciona una suite; falta de comando o imposibilidad de ejecutarlo produce abstención | `run()` y `slim()` solo rechazan Stop; una abstención permite continuar sin verificación ejecutada |
| Simplificación | `DIET`, `diet()` y `slim()` reciben archivos propuestos, exigen las mismas rutas y menos líneas | No reciben la tarea original ni sus criterios; no pueden simplificar libremente la estructura entre archivos |
| Escritura | `apply.rs` escribe secuencialmente y une la raíz con las rutas recibidas | En esa ruta no se verifica confinamiento ni se garantiza recuperación ante fallo parcial |
| Recuperación | `restore_all()` confunde contenido vacío con archivo inexistente; `slim()` ignora un error de restauración | La recuperación puede borrar un archivo previamente vacío o dejar un estado distinto del anunciado |
| Medición | `bench/run.ts` mide orientación e indexación; existen tests de gates y orquestación | No demuestra todavía que Sens resuelva tareas mejor que el mismo modelo sin su política |

Estas observaciones son de análisis estático. Los fallos de recuperación y confinamiento requieren casos de regresión reproducibles antes de afirmar que están corregidos.

## Alternativas

1. Mejorar únicamente instrucciones y quitar el límite fijo. Es barato y permite un control experimental, pero mantiene la falta de lectura, memoria de reparación y garantías de escritura.
2. Evolucionar el motor existente con investigación, contrato de tarea y verificación explícita. Es la opción recomendada: reutiliza índice, consultas, proveedores, eventos y aplicación, atacando las carencias observadas.
3. Delegar la ejecución completa a un agente externo y revisar después. Ofrece capacidades rápidamente, pero dificulta controlar qué se escribe, atribuir resultados y mantener un comportamiento homogéneo entre proveedores.

## Diseño recomendado

### Investigar y definir lo que debe conservarse

Ampliar el contrato de `Model` para permitir solicitudes de lectura y consulta antes de una propuesta final. Sens ejecutaría esas solicitudes mediante las consultas existentes y un lector limitado al proyecto. No hace falta incorporar embeddings ni otro indexador inicialmente.

El contexto debe incluir implementaciones afectadas, llamadores relevantes, pruebas existentes, manifiestos y reglas del proyecto. Un archivo existente solo puede reemplazarse si su contenido completo ha sido leído en la sesión y su versión sigue coincidiendo. El índice sirve para localizar; la lectura permite comprender.

Guardar por tarea requisitos, comportamientos que preservar y comprobaciones previstas. Registrar referencias breves a evidencia y decisiones de reutilización, sin exigir una exposición del razonamiento interno. Si falta un requisito que altera el comportamiento, solicitar aclaración; las decisiones rutinarias se resuelven con el contexto disponible.

La investigación tiene un presupuesto de herramientas, tiempo y contexto. Agotarlo con información insuficiente produce una tarea incompleta explicada, no una edición a ciegas.

### Proponer, verificar y recuperar

Mantener el formato actual de archivos completos en la primera iteración para evitar otra migración simultánea. Validar estrictamente todas las entradas y rutas, distinguiendo creación, modificación y eliminación explícita. Rechazar propuestas parcialmente ilegibles en vez de descartar entradas silenciosamente.

Antes de escribir: comprobar rutas resueltas, enlaces que escapen del proyecto y cambios concurrentes; capturar existencia, bytes y metadatos necesarios. Aplicar con respaldo y recuperación registrada para todos los archivos. Ante un fallo parcial, cancelación o fallo de simplificación, restaurar y comprobar el resultado. Si la recuperación falla, conservar los respaldos y comunicar el estado real. No prometer atomicidad de varios archivos con escrituras secuenciales.

Las pruebas pueden tener efectos fuera de los archivos editados. Para el prototipo, usar proyectos desechables y aislados; el aislamiento de ejecución general será un trabajo posterior explícito.

Definir verificaciones por proyecto y zona afectada: compilación o tipos, pruebas relevantes y aceptación de la tarea. Ejecutar una referencia inicial cuando sea viable para distinguir fallos previos. En repositorios mixtos no basta con seleccionar el primer manifiesto encontrado.

Separar resultados: verificado, fallido y no verificado. Una comprobación obligatoria ausente o no ejecutable deja la propuesta pendiente y no permite aceptación automática ni simplificación presentada como probada. Los tests de aceptación protegidos no pueden desaparecer o debilitarse dentro de la propuesta para producir un verde.

### Simplificar con contexto

Reutilizar el segundo pase existente, aportándole tarea, requisitos, versiones originales, propuesta, decisiones y evidencias de verificación. Buscar menos duplicación, capas, estado y dependencias innecesarias, además de líneas.

Aceptar que una revisión termine sin cambios. Una mejora de claridad o estructura no necesita reducir líneas, pero debe identificar un beneficio concreto y superar las mismas comprobaciones. Si la revisión falla, conservar la versión anterior verificada y comprobar la restauración.

Inicialmente se puede conservar la restricción de rutas para limitar el alcance. La optimización entre archivos y eliminación de módulos requiere después operaciones explícitas y revalidación del área ampliada.

## Evolución de los controles

| Control | Propuesta |
| --- | --- |
| G1 duplicación | Tratar coincidencias de nombres como candidatos que requieren inspección; reservar bloqueos para evidencia suficientemente precisa |
| G2 huérfanos | Conservar análisis y evidencia; expresar incertidumbre en usos dinámicos y respetar entradas públicas |
| G3 crecimiento | Convertir líneas, archivos y dependencias en señales para revisión; retirar el presupuesto universal como criterio de calidad |
| G4 pruebas | Exigir resultados explícitos para las comprobaciones obligatorias; abstención nunca equivale a éxito |
| G5 comentarios | Separar política editorial del proyecto de la corrección general; este repositorio conserva su regla actual mientras no se cambie expresamente |

El sello actual puede seguir identificando la configuración de controles; no debe presentarse como certificación de calidad del resultado.

## Orden de trabajo y aceptación

1. Fiabilidad de cambios y verificaciones. Casos para rutas externas, enlaces, archivo vacío, error en el segundo archivo, recuperación fallida, cambios concurrentes y suite no ejecutable. Ninguno debe terminar como éxito silencioso.
2. Investigación y contexto persistente. Una tarea debe demostrar lectura del código afectado, consulta de consumidores y conservación de contexto al reparar. Una propuesta sobre una versión obsoleta se rechaza antes de escribir.
3. Política y revisión contextual. Sustituir el bloqueo fijo, transmitir requisitos al revisor y mantener el resultado verificado si la simplificación no mejora o falla.
4. Evaluación comparativa. Ejecutar las tareas siguientes con el mismo modelo y presupuesto; publicar también errores, rechazos y resultados sin mejora.

Este documento propone varios incrementos, no una reescritura conjunta. El primer cambio implementable es la fiabilidad de aplicación y verificación; la investigación viene inmediatamente después. La interfaz solo necesita representar los estados reales que produzca el motor.

## Prueba de concepto

Preparar tres tareas con criterios de aceptación definidos antes de generar código:

| Tarea | Qué comprobar |
| --- | --- |
| Funcionalidad con un componente reutilizable existente | Integración, estados de error y accesibilidad aplicable; reutilización correcta sin una dependencia nueva injustificada |
| Error en una función compartida por varios consumidores | Corrección de la causa y casos límite en todos los consumidores afectados |
| Simplificación de lógica repetida | Comportamiento preservado, manejo de errores y ausencia de capas nuevas innecesarias |

Comparar tres condiciones en el mismo arnés: instrucciones neutras, principios inspirados en Ponytail, y Sens con índice y revisión. Dar a las tres herramientas suficientes para resolver la tarea; fijar modelo, revisión del repositorio y presupuesto total, incluyendo el segundo pase. Aislar configuraciones y sesiones. Empezar con tres repeticiones por tarea y condición: 27 ejecuciones, una exploración y no un resultado estadístico concluyente.

Medir primero aceptación y regresiones. Solo entre soluciones válidas comparar líneas después del formateo habitual, archivos y dependencias añadidos, duplicación, claridad mediante revisión con rúbrica, tiempo y consumo. Incluir una tarea cuya solución ya sea mínima para no premiar cambios artificiales. Guardar propuestas y diffs; las pruebas de aceptación independientes se ejecutan sobre cada resultado.

Criterio para continuar: todos los casos de fiabilidad del motor pasan; el piloto no muestra pérdida de requisitos ni regresiones frente al control y muestra mejoras justificadas en soluciones válidas. Si aparecen pérdidas, se corrige el proceso antes de ampliar el producto. El piloto no demuestra ausencia general de errores.

## Resultado de esta revisión

Sens ya tiene infraestructura aprovechable. La prioridad es darle suficiente información para decidir y suficiente verificación para confiar en sus cambios. La reducción de código debe evaluarse después de satisfacer el contrato funcional.

La revisión inicial no modificó el motor ni instaló Ponytail. Tras la aprobación se implementó el incremento descrito a continuación. El benchmark comparativo y las llamadas a modelos reales siguen sin ejecutarse.

## Primer incremento: aplicación y verificación fiables

Implementado en `rust/sens-agent/src/apply.rs`, `lib.rs` y `model.rs`, con pruebas en el módulo de aplicación, `tests/g4_gate.rs` y `rust/sens-hook/src/gate/trial.rs`.

La aplicación captura los originales antes de juzgar el cambio y verifica contenido y fecha antes de escribir. Rechaza rutas externas, componentes ambiguos, rutas internas protegidas, enlaces y junctions, y destinos duplicados. Los originales no legibles como UTF-8 se rechazan en vez de confundirse con archivos inexistentes. Una propuesta parcialmente malformada se rechaza entera.

Antes de modificar archivos guarda los originales y un manifiesto en un directorio único `sens-recovery-*` dentro del directorio temporal del sistema. Cada archivo se prepara en un archivo temporal hermano y se renombra al destino. Ante un fallo posterior restaura los archivos ya escritos, conserva los archivos originalmente vacíos, elimina las nuevas rutas creadas por la transacción cuando es posible y restablece fechas de modificación. Si detecta cambios ajenos durante la recuperación, no los sobrescribe: informa del fallo y de la ubicación del respaldo, intentando recuperar los demás archivos.

Una abstención de G4 restaura el parche y termina como no verificado, sin llamar al simplificador ni consumir reintentos de reparación. La orden de pruebas se selecciona antes de aplicar cada propuesta. La simplificación también necesita Pass; ante un fallo de pruebas recupera la versión verificada. La cancelación en los puntos de control posteriores a escritura restaura la versión inicial. Ningún error de restauración se ignora para emitir éxito.

Validación realizada en Windows:

- `cargo test --manifest-path rust/sens-agent/Cargo.toml --offline`: 63 pruebas superadas; dos pruebas con modelos reales permanecen ignoradas.
- `cargo test --manifest-path rust/sens-hook/Cargo.toml --offline gate::trial`: seis pruebas superadas.
- `cargo check --manifest-path rust/sens-app/Cargo.toml --offline`: correcto.

Límites de este incremento: los reemplazos de archivos no forman una transacción atómica global; no hay recuperación automática al reiniciar tras una caída, aunque los respaldos previos quedan en el directorio temporal. La recuperación cubre archivos del parche y directorios creados por él, no efectos arbitrarios de tests o comandos externos. La comprobación de rutas y versiones reduce conflictos pero no constituye un sandbox contra un proceso hostil que cambie el sistema de archivos entre comprobaciones. No se garantiza conservar ACL, atributos extendidos o todos los metadatos específicos de cada sistema. La cancelación se atiende en puntos de control, no interrumpe inmediatamente una llamada al modelo o la suite.

Siguen pendientes la protección independiente de los tests de aceptación, la validación de todas las zonas de un repositorio mixto y la ejecución aislada. El siguiente incremento funcional es la investigación del código y la conservación de contexto; los controles de crecimiento y las instrucciones de simplificación aún conservan su comportamiento anterior.
