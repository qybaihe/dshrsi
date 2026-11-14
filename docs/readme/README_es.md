<div align="center">

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · **Español** · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md) · [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md) · [Roman Urdu](README_ur-Latn.md) · [Română](README_ro.md)

<br />

<img src="../../packages/dsh-rsi/icon.svg" alt="DSHRSI" width="88" />

# DSHRSI: Recursive Self-Improvement (automejora recursiva) para DeepSeek Harness

### **Observar → Mejorar → Construir sobre lo mejorado → Y otra vez. Un harness que cada vez es más tuyo.**

<a href="https://qybaihe.github.io/dshrsi/trace.html">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../assets/rsi-trace.dark.gif" />
    <img src="../../assets/rsi-trace.gif" alt="Animación de la traza de una ejecución real: con el harness original, 12 de 30 sesiones hacen la misma llamada fallida; con DSHRSI, a la tercera vez el harness se mejora a sí mismo, y en las 22 sesiones siguientes solo ocurre una vez" width="960" />
  </picture>
</a>

**RSI significa Recursive Self-Improvement, automejora recursiva, y DSHRSI es el plugin de código abierto que la hace realidad en DeepSeek Harness. El harness observa sus propias ejecuciones, hace que el propio modelo de la sesión escriba código de harness para los problemas que encuentra, pone a prueba ese código en un filtro de 5 etapas y lo monta antes de que termine el turno. Después, el harness mejorado ejecuta la siguiente sesión y vuelve a mejorar. Sin fine-tuning. Sin montañas de prompts. Código que se mide, se conserva, se reescribe o se descarta.**

[![RSI](https://img.shields.io/badge/RSI-Recursive_Self--Improvement-4d6bfe?style=for-the-badge)](#rsi)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek_Harness-0.2.2--rc.3_plugin-7c5cff?style=for-the-badge)](https://github.com/deepseek-ai/deepseek-harness)
[![Validation](https://img.shields.io/badge/Validation-5--Stage_Gate-0ea5e9?style=for-the-badge)](#how-it-works)
[![Benchmarks](https://img.shields.io/badge/Benchmarks-4_Suites_%C2%B7_2_Models-2563eb?style=for-the-badge)](#benchmarks)
[![MIT License](https://img.shields.io/badge/License-MIT-38bdf8?style=for-the-badge)](../../LICENSE)

**[🌐 Sitio web](https://qybaihe.github.io/dshrsi/) · [📖 Referencia del plugin](../../packages/dsh-rsi/README.md) · [🐛 Issues](https://github.com/qybaihe/dshrsi/issues)**

[Qué significa RSI](#rsi) · [Inicio rápido](#quick-start) · [Cómo funciona](#how-it-works) · [Resultados medidos](#measured) · [Benchmarks](#benchmarks) · [Detectores y capacidades](#coverage) · [Harness de proyecto](#project-harness) · [Seguridad por defecto](#security) · [Preguntas frecuentes](#faq)

</div>

---

> [!IMPORTANT]
> **Versión preliminar para desarrolladores:** DSHRSI está desarrollado sobre DeepSeek Harness `0.2.2-rc.3`, que a su vez es una versión preliminar para desarrolladores. **Habrá cambios que rompan la compatibilidad.**
> Una adaptación es código escrito por un modelo que se ejecuta dentro de tu harness. Su aislamiento protege contra errores, **no contra código malicioso**. Lee sobre [el filtro de validación](../../packages/dsh-rsi/README.md#the-validation-gate) antes de ejecutarlo.

<div align="center">
<img src="../../assets/ui-evolving.png" alt="Una sesión de DeepSeek Harness: dos llamadas a herramientas fallan con el código de salida 127 y, a continuación, la insignia RSI y la píldora bajo el cuadro de mensaje se encienden mientras el harness se mejora a sí mismo" width="1200" />
</div>

<br />

<table>
<tr>
<td width="33%" valign="top">

### 🔴 Sin DSHRSI
Cada sesión redescubre los mismos hechos: esta máquina no tiene `python`, este repositorio tiene una regla que ya indicaste, este arreglo nunca se verificó. En la ejecución de control, **5 sesiones de 5** hicieron la misma llamada fallida, y una regla que el usuario había indicado volvió a incumplirse una sesión después.

</td>
<td width="33%" valign="top">

### 🧬 Con DSHRSI
Cuando el problema vuelve, el modelo escribe un fragmento de código de harness, este pasa el filtro y queda activo **en ese mismo turno**. En 3 ejecuciones con un modelo real, **7 sesiones de 7** posteriores a la adaptación no tuvieron ninguna llamada fallida. Y la siguiente mejora parte de ahí.

</td>
<td width="33%" valign="top">

### 🔒 Solo restringe, por diseño
Una adaptación puede añadir información, rechazar una llamada, preguntarte antes o exigir una verificación. **Ninguna capacidad puede permitir lo que el harness rechazaría.** Reescribir resultados, añadir herramientas y ejecutar comandos quedan a la espera de tu aprobación.

</td>
</tr>
</table>

---

<a id="rsi"></a>

## 🔁 RSI = Recursive Self-Improvement, automejora recursiva

No es “reescribirse a sí mismo”. Es **Recursive Self-Improvement**, automejora recursiva: un sistema usa sus propias capacidades para mejorarse, y el sistema mejorado se encarga de la siguiente ronda. Tres palabras, y DSHRSI tiene que ganarse cada una:

| | Qué exige | Cómo lo hace DSHRSI |
| :--- | :--- | :--- |
| **Self** (uno mismo) | Lo que actúa y lo que se modifica son el mismo sistema | El harness cambia al harness. La adaptación la escribe el modelo de la misma sesión que se topó con el problema. Nadie lo ajusta desde fuera |
| **Improvement** (mejora) | “Mejor” tiene que poder comprobarse | Toda adaptación pasa un filtro de 5 etapas antes de montarse, y las sesiones posteriores la vuelven a examinar: lo que funciona se promueve, lo que lanza excepciones va a cuarentena |
| **Recursive** (recursiva) | El resultado de una ronda es el punto de partida de la siguiente | La siguiente sesión se ejecuta sobre el harness mejorado y se observa con él. Una adaptación que no bastó se reescribe más estricta a partir de la evidencia. Una que hace falta en un segundo espacio de trabajo se amplía a toda la máquina, y las reglas de un proyecto viajan al harness de cada compañero de equipo |

**Cuatro bucles, cada uno dentro del siguiente:** dentro de un turno → de sesión en sesión → la propia mejora se mejora → de un proyecto a una máquina y a un equipo.

Lo que deliberadamente **no** es recursivo: los pesos del modelo nunca cambian, y los detectores, la política de activación y el filtro de validación son código fijo que ninguna adaptación puede tocar. La parte que se modifica a sí misma la revisa una parte que ella no puede modificar.

---

<a id="quick-start"></a>

## ⚡ Inicio rápido en 30 segundos

### 1. Instálalo donde ya trabajas
En la app de escritorio de DeepSeek Harness o en la interfaz web, abre **Plugins → Add plugin → Install a third-party plugin**, pega el enlace al paquete de la release, selecciona **Install** y después **Enable now**:

```text
https://github.com/qybaihe/dshrsi/releases/download/v0.1.3/dsh-rsi-0.1.3.tgz
```

O desde la línea de comandos. Cada perfil tiene sus propios plugins, y `dsh plugin add` llama a `pnpm`, que tiene que estar en el `PATH`:

```bash
dsh plugin --profile web add https://github.com/qybaihe/dshrsi/releases/download/v0.1.3/dsh-rsi-0.1.3.tgz
dsh web
```

### 2. Trabaja como siempre
No hay nada que configurar. DSHRSI no se deja ver hasta que el mismo problema vuelve. Entonces la insignia **RSI** se enciende, la píldora bajo el cuadro de mensaje te avisa de que el harness acaba de cambiarse a sí mismo, y la siguiente sesión arranca ya mejorada:

<div align="center">
<img src="../../assets/ui-panel-dark.png" alt="La siguiente sesión: la píldora está desplegada y muestra la adaptación en acción y la llamada que rechazó antes de que se ejecutara" width="1200" />
</div>

Escribe `/rsi` en cualquier sesión para ver qué está montado, a qué capa pertenece y qué está esperando tu aprobación.

Los perfiles `desktop` y `headless`, los índices de plugins, los tarballs locales y la carga para una sola ejecución se explican en la [referencia del plugin](../../packages/dsh-rsi/README.md#install).

---

<a id="how-it-works"></a>

## 🧠 Cómo funciona DSHRSI: un bucle cerrado dentro del harness, que se repite una y otra vez

<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../assets/pit-stop.dark.svg" />
  <img src="../../assets/pit-stop.svg" alt="Cómo funciona DSHRSI, dibujado como una parada en boxes: el coche es el harness, el piloto es el modelo y la pieza nueva es código del harness escrito a mitad del turno" width="960" />
</picture>
</div>

Las skills, los archivos de memoria y los prompts de sistema más largos actúan todos a nivel de contexto: añaden texto y esperan que el modelo lo siga. Cuando no lo hace, la misma llamada fallida se repite en la siguiente sesión.

**DSHRSI actúa a nivel del harness. Lo que aprende se convierte en código en los propios puntos de extensión del harness:**

| Etapa | Mecanismo | Efecto |
| :--- | :--- | :--- |
| **1. Observar** | 16 detectores leen eventos de sesión normalizados: llamadas que vuelven a fallar, causas de fallo que se repiten, intentos a ciegas, correcciones del usuario, turnos que terminan sin nada verificado. | El problema recibe una firma que se mantiene igual de una sesión a otra. |
| **2. Reescribir** | El propio modelo de la sesión escribe una adaptación en JavaScript contra una API de 10 capacidades. El código rechazado vuelve con los motivos, dos veces como máximo; después toma el relevo una plantilla integrada. | El arreglo es código de harness, no un párrafo más de prompt. |
| **3. Validar** | Estático → carga → reproducción → regresión → permisos. La adaptación tiene que actuar sobre las llamadas que la provocaron y no debe tocar ninguna llamada que haya tenido éxito en esta sesión. | El código que no hace nada, o que rompe lo que ya funcionaba, nunca se monta. |
| **4. Montar** | La adaptación se ejecuta en su propio contexto aislado, con timeout en cada llamada, y surte efecto antes de la siguiente petición al modelo. | El turno que se topó con el problema es el primero en beneficiarse. |
| **5. Conservar y compartir** | Cada máquina conserva una biblioteca de adaptaciones. Lo que funciona se promueve, lo que lanza excepciones va a cuarentena, lo que no bastó se reescribe más estricto, y las reglas del proyecto se escriben en el repositorio. | La siguiente sesión arranca ya adaptada, y los compañeros de equipo reciben las reglas del proyecto en cuanto las aceptan. |
| **↻ Otra vez** | La siguiente sesión se ejecuta sobre el harness que dejó la etapa 5, y la etapa 1 la observa con todas las adaptaciones en su sitio. | La mejora se construye sobre la mejora. Eso es la recursión. |

---

<a id="measured"></a>

## 🔬 Medido con un modelo real

Estas cifras salen de ejecutar un modelo real, `mimo-v2.6-pro`, en sesiones reales de `dsh` (`npm run test:live`). Nada en esta tabla está simulado.

> **Cómo leer esto:** la muestra es pequeña. Un modelo, tres escenarios, un puñado de sesiones en cada uno. Muestra que el bucle funciona de principio a fin. **No** es una afirmación estadística sobre tasas de éxito, y nada se volvió más rápido: escribir una adaptación supone esperar al modelo 30–60 segundos. Las ejecuciones a mayor escala están en [Benchmarks](#benchmarks).

| Escenario | Sin DSHRSI | Con DSHRSI | Qué escribió el harness |
| :--- | :--- | :--- | :--- |
| **Falta un comando**: las instrucciones dicen `python`, la máquina solo tiene `python3` | ❌ **5 / 5** sesiones hicieron la llamada fallida | ✅ **0 / 7** sesiones tras la adaptación (9 / 9 antes de ella) | `deny` + `prompt`, escrita por el modelo; pasó el filtro al primer intento |
| **Una regla que el usuario dijo una sola vez**: no modificar nunca un archivo concreto, sino escribir en un borrador de ese archivo | ❌ La siguiente sesión editó el archivo | ✅ La siguiente sesión escribió en el borrador sin que nadie se lo pidiera | `deny` + `prompt`, escrita por el modelo justo después de la corrección |
| **Un arreglo que nadie pidió verificar** | no se ejecutó | ⚪ No se escribió nada: el modelo verificó su arreglo en 3 / 3 sesiones, así que no había nada que aprender | ninguna |

---

<a id="benchmarks"></a>

## 📊 Benchmarks: cuatro suites, dos modelos, tarea a tarea

DeepSeek Harness original frente a DeepSeek Harness + DSHRSI, en 3,390 sesiones reales de `dsh`: el mismo modelo, los mismos prompts, el mismo sandbox, las mismas tareas. El plugin se ejecuta con su configuración por defecto y empieza cada suite con una biblioteca vacía. Tareas resueltas en las tres suites que se ejecutaron hasta el final:

<!-- bench:table:start -->
| Benchmark | Tareas | `mimo-v2.6-pro` original | `mimo-v2.6-pro` + DSHRSI | `mimo-v2.6-flash` original | `mimo-v2.6-flash` + DSHRSI |
| :--- | ---: | ---: | ---: | ---: | ---: |
| **Aider Polyglot**, al primer intento | 225 | 224 (99.6%) | 224 (99.6%) | 220 (97.8%) | 223 (99.1%) |
| **Aider Polyglot**, en dos intentos como máximo | 225 | 225 (100.0%) | 225 (100.0%) | 225 (100.0%) | 225 (100.0%) |
| **HumanEval** | 164 | 163 (99.4%) | 162 (98.8%) | 162 (98.8%) | 162 (98.8%) |
| **HumanEval+** | 164 | 156 (95.1%) | 157 (95.7%) | 153 (93.3%) | 153 (93.3%) |
| **MBPP** | 378 | 374 (98.9%) | 371 (98.1%) | 368 (97.4%) | 369 (97.6%) |
| **MBPP+** | 378 | 320 (84.7%) | 319 (84.4%) | 308 (81.5%) | 315 (83.3%) |
<!-- bench:table:end -->

<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../assets/bench-flash.dark.png" />
  <img src="../../assets/bench-flash.png" alt="mimo-v2.6-flash, DSH → DSH + DSHRSI: Aider Polyglot 220 → 223 / 225 (+3), HumanEval 162 → 162 / 164, HumanEval+ 153 → 153 / 164, MBPP 368 → 369 / 378 (+1), MBPP+ 308 → 315 / 378 (+7). Rust lib.rs: 12 / 30 → 5 / 30, 7 / 22 → 1 / 22" width="960" />
</picture>
</div>

> **Cómo leer esto:** en tareas resueltas, los dos harness **no se pueden distinguir**. La mayor ganancia es +7 (MBPP+ con `mimo-v2.6-flash`), la mayor pérdida es −3 (MBPP con `mimo-v2.6-pro`), y ninguna diferencia se sostiene en una prueba exacta de McNemar sobre las mismas tareas (el menor p = 0.17). Cuando el agente puede ejecutar su propio código, estas suites están cerca de su techo para ambos modelos, y cada tarea es un directorio nuevo y limpio: es muy poco lo que vuelve a aparecer y de lo que un harness pueda aprender.

**Lo que DSHRSI sí hizo, sin una sola pista, fue cambiarse a sí mismo.** A lo largo de las ocho ejecuciones, los modelos escribieron **56 adaptaciones**; 15 de ellas llegaron a actuar, y 10 de esas se habían ampliado a toda la máquina. Para cada una de las 10 tomamos las tareas que empezaron después de ella y las comparamos con esas mismas tareas en DSH original:

| Fallo que el harness aprendió a evitar por sí solo | DSH original | DSH + DSHRSI | p |
| :--- | ---: | ---: | ---: |
| Una ejecución de pruebas que muere en su primera aserción fallida (MBPP, `mimo-v2.6-pro`) | 16 de 310 tareas | **3 de 310** | 0.002 |
| Leer un archivo en una ruta que no existe (Polyglot, `mimo-v2.6-flash`) | 7 de 151 tareas | **1 de 151** | 0.07 |
| Las otras 8 adaptaciones | sin cambio medible | | |

Ninguna de las dos hizo que pasaran más tareas, y el plugin costó alrededor de un 8–9% más de tiempo de agente y de tokens de entrada. Las diez están en las [notas de los benchmarks](../../bench/README.md#did-those-adaptations-work).

**LiveCodeBench v6 se interrumpió antes de terminar:** la cuenta del modelo se quedó sin saldo a mitad de la ejecución. En las tareas que ambos lados habían terminado para entonces, DSH original resolvió 94 y DSHRSI 96 de 105 con `mimo-v2.6-pro`, y 42 frente a 42 de 51 con `mimo-v2.6-flash`. Por el mismo motivo, la segunda pasada (las mismas tareas otra vez, sobre la biblioteca que dejó la primera) todavía no se ha ejecutado.

El protocolo, las tablas de costo y de fallos, las limitaciones y los comandos para reproducirlo todo están en las [notas de los benchmarks](../../bench/README.md).

---

<a id="coverage"></a>

## 🛡️ Detectores y capacidades

**16 detectores** deciden cuándo debe cambiar el harness. La [lista completa](../../packages/dsh-rsi/README.md#detectors) está en la referencia del plugin.

**10 capacidades** son todo lo que una adaptación puede hacer. Solo llega al harness a través de ellas:

| Capacidad | Qué hace | Nivel |
| :--- | :--- | :---: |
| `annotate` | Añade una nota al resultado de una herramienta | ✅ automático |
| `steer` | Añade una nota antes de la siguiente petición al modelo | ✅ automático |
| `deny` | Rechaza una llamada a herramienta e indica el motivo | ✅ automático |
| `ask` | Exige la aprobación del usuario para una llamada | ✅ automático |
| `block` | Convierte el resultado de una herramienta en un error que lleva una corrección | ✅ automático |
| `verify` | Impide que el turno termine mientras no se cumpla una condición | ✅ automático |
| `prompt` | Añade una sección permanente al prompt de sistema | ✅ automático |
| `rewrite` | Sustituye el texto del resultado de una herramienta | 🔐 requiere aprobación |
| `tool` | Registra una herramienta nueva para el modelo | 🔐 requiere aprobación |
| `exec` | Ejecuta un comando mediante la herramienta de shell del harness, bajo las mismas reglas de sandbox y de aprobación | 🔐 requiere aprobación |

Esta es la adaptación que el modelo escribió en el primer escenario de arriba:

```js
define({
  title: 'Route python invocations to python3',
  description: '...',
  capabilities: ['deny', 'prompt'],
  setup(h) {
    h.promptSection('On this machine there is no `python` executable; use `python3`.')
    h.beforeTool({ tool: 'bash', command: /(^|[;&|(]\s*)python(\s|$)/ },
      () => h.deny('`python` is not installed on this machine. Use `python3` instead.'))
  },
})
```

---

<a id="project-harness"></a>

## 🧩 Tres capas, y un harness por proyecto

Toda adaptación pertenece a una de tres capas. Cada capa se puede desactivar por separado:

| Capa | Qué contiene | Ejemplo | Dónde se aplica |
| :--- | :--- | :--- | :--- |
| **`machine`** | Hechos sobre esta máquina | No hay `python`; un puerto está ocupado; un host interno no se resuelve | El espacio de trabajo donde se aprendió y, después, toda la máquina en cuanto un segundo espacio de trabajo se topa con lo mismo |
| **`user`** | Cómo quieres que te traten | Una respuesta marcada como mala con el motivo “demasiado larga” | Toda la máquina |
| **`project`** | Las reglas y costumbres de un repositorio | “Este repositorio usa pnpm, siempre” | El espacio de trabajo, y el propio repositorio: se hace commit de las reglas junto con el código |

**La capa de proyecto viaja con el código:**

- **Haz commit para compartir, borra para desconectar.** Un archivo es una adaptación.
- **Nada se ejecuta por el mero hecho de haberse clonado.** Cada máquina acepta el contenido exacto de los archivos con `dsh-rsi trust`, y vuelve a aceptarlos cuando cambian.
- **Un proyecto solo puede hacer el harness más conservador**, nunca menos. Ajustes como `autonomy` quedan fuera del alcance de un proyecto.
- **Portátil más allá de un repositorio.** `dsh-rsi export` y `dsh-rsi import` llevan las capas de máquina y de usuario a otra máquina en un solo archivo.

---

<a id="security"></a>

## 🔒 Seguridad y configuración por defecto

- **Nivel automático que solo restringe** — Sin tu aprobación, una adaptación solo puede añadir información, rechazar, preguntar o exigir una verificación. Sus `deny` y `ask` solo pueden hacer más estricto el veredicto de las demás políticas.
- **Lo potente requiere aprobación (`autonomy: tighten`)** — Las adaptaciones que reescriben resultados, añaden herramientas o ejecutan comandos se guardan como `proposed` y esperan a `dsh-rsi approve <id>`.
- **Invisible hasta que hace falta** — Sin fricción y sin nada montado, el prompt de sistema, la lista de herramientas y los mensajes quedan idénticos byte a byte. Una prueba end-to-end lo vigila.
- **Fallos contenidos** — Un handler que lanza una excepción nunca afecta a la llamada a herramienta a la que está asociado. Tras tres errores, la adaptación pasa a cuarentena.
- **Todo queda registrado** — Cada decisión, fricción, montaje y acción se anota en el registro. `dsh-rsi disable`, `retire` y `rollback` retiran una adaptación o la revierten.
- **Tres modos** — `adapt` monta directamente (el modo por defecto), `propose` genera y te espera, `observe` solo registra.

---

<a id="faq"></a>

## ❓ Preguntas frecuentes

<details>
<summary><strong>¿DSHRSI hace fine-tuning o cambia el modelo?</strong></summary>

No. Los pesos del modelo no se tocan y no se entrena nada. Lo que cambia es el harness: el código que se ejecuta alrededor de los prompts y de las llamadas a herramientas del modelo. Aquí RSI es automejora recursiva a nivel del harness: se mejora a sí mismo a partir de sus propias ejecuciones, y cada ronda parte del harness que dejó la anterior.
</details>

<details>
<summary><strong>¿Es de verdad “recursivo”, o solo un harness que aprende reglas?</strong></summary>

La recursión es concreta y está en el código. Una sesión nueva monta todo lo que contiene la biblioteca, así que los detectores observan un harness que ya ha cambiado. Cuando el mismo problema aparece dos veces en sesiones que tenían una adaptación montada, el modelo recibe el código fuente actual y la evidencia, y escribe una versión más estricta; la anterior se conserva para poder hacer rollback. Un problema que aparece en un segundo espacio de trabajo amplía una adaptación a toda la máquina. Lo que no es recursivo es el juez: ninguna adaptación puede cambiar los detectores, la política de activación ni el filtro de validación.
</details>

<details>
<summary><strong>¿En qué se diferencia de las skills, los archivos de memoria o un prompt de sistema más largo?</strong></summary>

Todo eso añade texto que el modelo puede seguir o no. Una adaptación es código en los puntos de extensión del harness: puede rechazar una llamada a herramienta antes de que se ejecute, exigir tu aprobación o impedir que un turno termine mientras no se haya verificado nada. En las ejecuciones medidas, el modelo siguió intentando usar `python` en 3 sesiones después de que se le dijera que no lo hiciera, y la llamada se rechazó antes de ejecutarse.
</details>

<details>
<summary><strong>¿Ralentiza mis sesiones?</strong></summary>

Escribir una adaptación supone esperar una respuesta completa del modelo: 30–60 segundos con `mimo-v2.6-pro`, durante los cuales el paso queda detenido. Las adaptaciones montadas se ejecutan dentro del proceso, con timeouts. No se midió ninguna mejora de velocidad y no se afirma ninguna.
</details>

<details>
<summary><strong>¿Puede una adaptación escrita por un modelo hacer algo peligroso?</strong></summary>

El nivel automático no puede permitir nada que el harness rechazaría, y las capacidades potentes esperan tu aprobación. El código se ejecuta en su propio contexto `node:vm` detrás de un puente JSON. Esto protege contra errores y contra el mal uso ocasional. **No** es una barrera de seguridad contra código malicioso, así que lee los archivos `.dsh-rsi/` de un proyecto antes de ejecutar `dsh-rsi trust`.
</details>

<details>
<summary><strong>¿Con qué modelos funciona?</strong></summary>

Las adaptaciones las escribe el modelo actual de la sesión, o el que indiques con `provider` y `model`. Si el modelo no consigue producir código que pase el filtro, toman el relevo las plantillas integradas. Las ejecuciones hechas hasta ahora usaron dos modelos de una misma familia, `mimo-v2.6-pro` y `mimo-v2.6-flash`.
</details>

<details>
<summary><strong>¿Funciona en la app de escritorio de DeepSeek Harness?</strong></summary>

Se distribuye como un plugin de terceros como cualquier otro, con los metadatos que leen las páginas de plugins, y se instala en el perfil `web` que la app envuelve. Todavía no se ha verificado dentro de la app de escritorio real.
</details>

<details>
<summary><strong>¿Y si una mejora resulta ser errónea?</strong></summary>

Siempre se puede deshacer: el propio código del harness no se toca nunca, y jamás se borra ninguna versión de una adaptación. El harness da marcha atrás por sí solo cuando una adaptación sigue fallando, o cuando resulta que una llamada que esta rechazó sí funciona. Tú también puedes hacerlo: `/rsi undo` deshace el último cambio, `dsh-rsi restore` devuelve todo el harness a un punto anterior y `/rsi off` ejecuta el harness original. Todo esto surte efecto en la sesión que ya está en curso. [Cómo funciona la vuelta atrás](../../packages/dsh-rsi/README.md#going-back).
</details>

<details>
<summary><strong>¿Cómo veo, deshago o desactivo lo que ha aprendido?</strong></summary>

`/rsi` en una sesión, o `dsh-rsi status` en una terminal. `dsh-rsi show <id>` imprime el código fuente de una adaptación y su informe de validación; `disable`, `retire` y `rollback` la retiran o la revierten. Configura `mode: observe` para registrar sin cambiar nada.
</details>

---

<a id="docs"></a>

## 📚 Documentación y enlaces

- [📖 Referencia del plugin](../../packages/dsh-rsi/README.md) — todos los detectores, capacidades, comandos y ajustes
- [🚀 Fuentes de instalación y perfiles](../../packages/dsh-rsi/README.md#install)
- [🧩 Capas y el harness de proyecto](../../packages/dsh-rsi/README.md#layers-and-the-project-harness)
- [🔬 El filtro de validación](../../packages/dsh-rsi/README.md#the-validation-gate)
- [🛠️ Línea de comandos de `dsh-rsi`](../../packages/dsh-rsi/README.md#command-line) · [⚙️ Configuración](../../packages/dsh-rsi/README.md#configuration)
- [⚠️ Limitaciones conocidas](../../packages/dsh-rsi/README.md#known-limits)
- [📊 Protocolo y resultados de los benchmarks](../../bench/README.md)
- [🧱 DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — el harness al que se conecta este plugin

<a id="contributing"></a>

## 🤝 Contribuir y comunidad

Los issues y los PR son bienvenidos en [qybaihe/dshrsi](https://github.com/qybaihe/dshrsi). Antes de enviar un PR:

```bash
npm install && npm test    # 130 pruebas unitarias y, después, 29 pruebas end-to-end; no hace falta ninguna clave
```

Las pruebas end-to-end sustituyen el endpoint del modelo por uno simulado. Todo lo demás es real: el proceso `dsh`, la ejecución de herramientas, el log de sesión y la instalación del plugin.

## 📄 Licencia

[MIT](../../LICENSE)

---

Created in [T3 Code](https://t3.codes).
