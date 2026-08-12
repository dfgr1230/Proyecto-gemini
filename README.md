# Plataforma de Aprendizaje Adaptativo

Proyecto para el hackathon **Build with Gemini / XPRIZE**, categoría **Education & Human Potential**.

Una aplicación web donde un estudiante hace un diagnóstico inicial breve, recibe una orientación de aprendizaje generada por **Google Gemini**, y practica ejercicios de matemáticas y lenguaje cuya **dificultad y materia las decide Gemini después de cada respuesta**, a partir de la evidencia real que el estudiante va dejando.

---

## 1. El problema

En un aula de treinta estudiantes, todos reciben el mismo ejercicio al mismo tiempo. Quien va adelantado se aburre; quien va atrasado se bloquea y acumula vacíos que nadie detecta a tiempo. Personalizar de verdad exige que alguien mire cada respuesta, entienda *por qué* falló y decida qué conviene poner a continuación — un trabajo que no escala con el tiempo docente disponible.

El problema no es la falta de contenido educativo: es la falta de **decisión pedagógica individualizada y continua**.

## 2. La solución y el alcance del MVP

Esta plataforma pone esa decisión en manos de un modelo de lenguaje, de forma acotada y auditable.

Dentro del alcance del MVP:

- Registro, confirmación por correo e inicio de sesión.
- Test de diagnóstico inicial de 12 preguntas sobre preferencias de aprendizaje.
- Generación del perfil con una llamada real a Gemini, y su persistencia.
- Ciclo de ejercicios adaptativos de matemáticas y lenguaje.
- Conservación de cada intento y de cada análisis adaptativo.
- Ajuste de nivel y de materia decidido por el modelo.
- Vista de progreso básico.
- Aislamiento de datos por usuario mediante Supabase Auth y Row Level Security.

Fuera del alcance, deliberadamente: panel administrativo, analítica compleja, multidioma completo, pagos.

## 3. Cómo participa Gemini en decisiones esenciales

Gemini no adorna la interfaz: **es quien decide**. El reparto de responsabilidades es explícito, y la aplicación lo declara en pantalla en vez de atribuirse méritos ajenos.

| Decisión | Quién la toma |
|---|---|
| Estilo de aprendizaje del perfil inicial | **Gemini** |
| Nivel inicial sugerido (1–5) | **Gemini** |
| Análisis del desempeño tras cada respuesta (fortalezas, dificultades, habilidad prioritaria) | **Gemini** |
| Nivel recomendado para la siguiente actividad | **Gemini** |
| Materia de la siguiente actividad | **Gemini** |
| Enfoque y apoyo pedagógico recomendados | **Gemini** |
| Si una respuesta concreta es correcta | **PostgreSQL**, dentro de `registrar_intento()` |
| Qué ejercicio del banco encaja con la recomendación | Búsqueda determinista |

Dos matices que importan para entender el diseño:

- **La calificación no la hace el modelo.** Comparar la respuesta con la respuesta oficial lo hace la base de datos, porque es un hecho verificable y no debe depender de un generador de texto.
- **El análisis es acumulativo.** Cada llamada recibe el perfil base, el análisis anterior y el historial de intentos, no solo la última respuesta. La interfaz muestra el análisis previo junto al nuevo para que se vea qué cambió y por qué.

Si Gemini falla, la aplicación **lo dice**: registra el intento, informa de que el análisis no está disponible y no inventa una recomendación de reserva presentándola como decisión de la IA.

## 4. Flujo del usuario

```
registro → confirmación por correo → login
   → diagnóstico (12 preguntas)
   → POST /api/perfil ── Gemini ──> perfil {estilo, nivel sugerido, explicación}  → persistido
   → /perfil (relee y revalida el perfil guardado)
   → /ciclo: responder ejercicio
        → POST /api/adaptar
             1. verifica la sesión contra el servidor de Auth
             2. lee perfil, banco e historial (bajo RLS)
             3. registra el intento  ── PostgreSQL decide si es correcto
             4. Gemini analiza perfil + análisis previo + historial + respuesta nueva
             5. conserva el análisis ligado al intento que lo originó
             6. elige la siguiente actividad con la recomendación
        → se muestra el análisis, el análisis anterior y la siguiente actividad
   → repetir
```

## 5. Stack

| Capa | Tecnología |
|---|---|
| Frontend + Backend | **Next.js 16** (App Router) + **React 19** |
| Lenguaje | **TypeScript** (modo estricto) |
| Autenticación | **Supabase Auth** |
| Base de datos | **Supabase / PostgreSQL** con **Row Level Security** |
| Motor de decisión | **Google Gemini** vía la API REST de **Google AI Studio** |
| Hosting | **Vercel** |
| Estilos | Tailwind CSS 4 |

No se instaló ningún SDK de Google: las llamadas se hacen con `fetch` nativo contra la API oficial, con salida estructurada (`responseMimeType` + `responseSchema`).

## 6. Arquitectura breve

```
src/
├─ app/
│  ├─ registro · login · auth/callback      páginas de autenticación
│  ├─ diagnostico · perfil                  test inicial y perfil persistido
│  ├─ actividad                             actividad única, selección determinista
│  ├─ ciclo                                 ciclo adaptativo completo
│  └─ api/
│     ├─ perfil/route.ts                    diagnóstico → Gemini → persistencia
│     └─ adaptar/route.ts                   respuesta → intento → Gemini → siguiente
├─ components/                              interfaz (auth · diagnostico · actividad · ciclo)
└─ lib/
   ├─ auth · diagnostico · actividad        contratos y validación
   ├─ adaptativo/                           ciclo, contrato de 9 claves, evidencia,
   │                                        persistencia, selección de la siguiente
   ├─ gemini/                               cliente de servidor y orquestación de prompts
   └─ supabase/                             cliente de navegador, de servidor y privilegiado

supabase/migrations/   0001 … 0006  (esquema, RLS, RPC, banco de ejercicios)
```

Principio transversal: **la lógica de decisión vive en funciones puras con dependencias inyectadas** (`src/lib/`), y las rutas de API solo atan esas dependencias a Supabase y a Gemini reales. Es lo que permite ejecutar el ciclo completo en pruebas locales sin red ni base de datos.

Las dos claves privadas (`GEMINI_API_KEY` y `SUPABASE_SECRET_KEY`) se leen cada una en **un solo archivo de servidor**, y ninguna lleva el prefijo `NEXT_PUBLIC_`, de modo que Next.js no puede incluirlas en el bundle del navegador.

## 7. URL de producción

**https://proyecto-gemini-phi.vercel.app**

**Actualizada el 12 de agosto de 2026** con el commit `8541b22`, en estado `Ready`. El ciclo adaptativo está desplegado: `/ciclo` responde 200 y `POST /api/adaptar` sin sesión responde 401. Un smoke test anónimo comprobó las siete páginas públicas y los dos endpoints; **no se creó ninguna cuenta y no se modificó ningún dato**.

El **recorrido autenticado completo en producción todavía no se ha ejecutado** — ver §15.

## 8. Requisitos locales

- Node.js 22 o superior (verificado con 22.18).
- npm 10 o superior (verificado con 10.9). El gestor es **npm**: el repositorio incluye `package-lock.json`.
- Un proyecto de Supabase con las migraciones `0001`–`0006` aplicadas.
- Una clave de la API de Gemini obtenida en [Google AI Studio](https://aistudio.google.com/app/apikey).

## 9. Variables de entorno

Copia `.env.example` a `.env.local` y rellénalo con tus propias claves. `.env.local` está en `.gitignore` y nunca debe subirse.

| Variable | Ámbito | Obligatoria |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | navegador y servidor | sí |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | navegador y servidor | sí |
| `SUPABASE_SECRET_KEY` | **solo servidor** | sí, para conservar los análisis |
| `GEMINI_API_KEY` | **solo servidor** | sí |
| `GEMINI_MODELO` | solo servidor | no — por defecto `gemini-3.6-flash` |

Si `SUPABASE_SECRET_KEY` falta, la aplicación **no se rompe**: el intento se registra, Gemini analiza, y la interfaz avisa explícitamente de que el análisis todavía no se conserva.

## 10. Ejecutar en local

```bash
npm install          # instalar dependencias
npm run dev          # servidor de desarrollo en http://localhost:3000
npx tsc --noEmit     # comprobación de tipos
npm run lint         # ESLint
npm run build        # build de producción
npm start            # servir el build de producción
```

Pruebas (no hay script `test` en `package.json`; se ejecutan con el runner nativo de Node):

```bash
node --test \
  src/lib/auth/contrato.test.mjs \
  src/lib/diagnostico/contrato.test.mjs \
  src/lib/diagnostico/consulta.test.mjs \
  src/lib/actividad/contrato.test.mjs \
  src/lib/adaptativo/contrato.test.mjs \
  src/lib/adaptativo/ciclo.test.mjs \
  scripts/checkpoint5-intentos.test.mjs
```

## 11. Cómo probar la aplicación desplegada

No hace falta abrir las herramientas de desarrollo ni conocer ninguna credencial:

1. Abre la URL de producción y crea una cuenta con un correo real.
2. Confirma la cuenta desde el enlace que llega por correo y vuelve a la aplicación.
3. Inicia sesión y responde las 12 preguntas del diagnóstico.
4. Al terminar verás tu perfil: estilo de aprendizaje, nivel sugerido y una explicación. **Lo generó Gemini** a partir de tus respuestas.
5. Pulsa «Iniciar ciclo adaptativo» y responde el ejercicio propuesto.
6. La pantalla de resultado muestra, sin necesidad de inspeccionar nada:
   - si la respuesta fue correcta, y que **la corrección la hizo la base de datos**;
   - el análisis completo de Gemini;
   - el nivel recomendado, y entre paréntesis el nivel anterior si cambió;
   - la materia y el enfoque de la siguiente actividad;
   - al pie, **el modelo que respondió y cuántos milisegundos tardó**.
7. Pulsa «Continuar con la siguiente actividad» y responde de nuevo. En la segunda iteración, el recuadro inferior cita explícitamente el análisis anterior: es la evidencia visible de que el ciclo acumula y no analiza cada respuesta de forma aislada.

## 12. Seguridad y aislamiento de datos

- **La identidad nunca la envía el navegador.** Las rutas de API extraen el token del encabezado `Authorization` y lo validan con `getUser(token)` contra el servidor de Auth de Supabase — no decodificando el JWT localmente. Aunque el cliente enviara un `usuario_id` en el cuerpo, se ignora.
- **Row Level Security en todas las tablas.** Cada usuario solo ve sus propios diagnósticos, intentos y análisis (`auth.uid() = usuario_id`). Los `GRANT` están además limitados por columna: el navegador puede insertar `(usuario_id, respuestas)` en `diagnosticos`, pero **no** `perfil_detectado`.
- **Las respuestas oficiales son inalcanzables desde el navegador.** La tabla `ejercicios_respuestas` tiene RLS activo **sin ninguna policy** y todos los privilegios revocados: solo la leen funciones `SECURITY DEFINER`. Como barrera redundante, la aplicación descarta cualquier ejercicio cuyo contenido público incluya una clave con forma de solución.
- **La calificación se hace en el servidor.** A `registrar_intento()` solo viajan el ejercicio, la respuesta y el tiempo. El veredicto y el `usuario_id` los deriva PostgreSQL.
- **La escritura de análisis es exclusiva del servidor.** La RPC `guardar_analisis_adaptativo()` no está concedida a `anon` ni a `authenticated`, así que nadie puede colgar de su propio intento un JSON con forma de análisis desde la consola del navegador. Incluso `service_role` tiene revocada la escritura *directa* sobre la tabla: solo puede ejecutar la RPC, que valida la estructura y deriva el `usuario_id` de la fila del intento.
- **Ninguna clave privada llega al cliente.** Verificado sobre los archivos generados en `.next/static`.

## 13. La orientación no es una evaluación clínica

El perfil que genera esta plataforma es una **orientación educativa**: estilo de aprendizaje preferido, nivel sugerido en una escala de 1 a 5 y una explicación breve. **No es un diagnóstico médico, clínico, psicológico ni terapéutico, y no debe usarse como tal.**

Esto no es solo una advertencia en el pie de página: está impuesto por el código. Diecinueve raíces de vocabulario clínico se rechazan **en dos capas independientes** —TypeScript y PostgreSQL— usando la misma normalización canónica, de modo que un análisis con lenguaje clínico se rechaza entero y nunca se persiste. Las 12 preguntas del diagnóstico son exclusivamente sobre preferencias de aprendizaje y autopercepción de dificultad; no se pregunta ni se infiere ninguna condición de salud, y no se solicita ningún dato personal más allá del nombre y el correo del registro.

## 14. Limitaciones conocidas

Se declaran de forma explícita porque el proyecto prefiere ser auditable a parecer terminado.

- **El recorrido autenticado en producción no se ha ejecutado.** Lo verificado en producción hasta ahora es anónimo: páginas públicas y rechazo de los endpoints sin sesión. Que el ciclo completo funcione contra la aplicación desplegada está demostrado en local y contra Supabase remoto, pero **no** todavía en producción.
- **La conservación de análisis en producción no está comprobada.** `SUPABASE_SECRET_KEY` ya está configurada en Vercel (Production y Preview), pero solo un recorrido autenticado puede demostrar que los análisis se conservan de verdad allí.
- **El banco de ejercicios tiene 5 ejercicios** (matemáticas niveles 1–3, lenguaje niveles 1–2). El ciclo se agota rápido y lo indica en vez de repetir contenido.
- **La prevención de intentos duplicados no es transaccional.** Se apoya en releer el historial antes de escribir, lo que cubre el doble clic, el reintento de red y la recarga. Dos peticiones verdaderamente simultáneas podrían crear dos filas; cerrar esa ventana exige un índice único, es decir, una migración nueva que no se hará antes de la entrega.
- **La protección de rutas en el cliente es una capa de UX, no de seguridad.** La autorización real la imponen siempre las policies RLS.
- **La selección de la siguiente actividad prioriza el nivel sobre la materia.** Si Gemini pide lenguaje y el banco no tiene lenguaje en ese nivel, se sirve otra materia en el nivel adecuado. La interfaz declara si la coincidencia fue exacta.
- **El retorno del enlace de confirmación de correo** no se ha validado de extremo a extremo; la cuenta queda utilizable, comprobado por el inicio de sesión posterior.

## 15. Estado honesto de la validación

Al 12 de agosto de 2026:

**Demostrado en ejecución real:** registro, confirmación e inicio de sesión; diagnóstico de 12 preguntas; llamada real a Gemini con `POST /api/perfil` respondiendo 200 y perfil persistido; dos interacciones consecutivas del ciclo adaptativo con análisis reales conservados, en las que el modelo subió el nivel tras un acierto, lo mantuvo tras el siguiente y cambió la materia de matemáticas a lenguaje, citando explícitamente el análisis anterior.

**Validado localmente:** comprobación de tipos, ESLint, build de producción y **389 pruebas automatizadas**, todas aprobadas.

**Verificado en producción (anónimo):** la versión actual está desplegada y en estado `Ready`. Las siete páginas públicas responden 200, y `POST /api/perfil` y `POST /api/adaptar` sin sesión responden **401** con un JSON breve y comprensible, sin trazas de pila ni datos internos. `SUPABASE_SECRET_KEY` está configurada en Production y Preview. Durante esta comprobación no se creó ninguna cuenta ni se modificó ningún dato.

**Pendiente:** el recorrido autenticado completo en producción; los controles remotos autenticados 1, 4, 5 y 10; la comprobación de lectura y escritura bajo RLS; el aislamiento con una segunda sesión; la idempotencia comprobada desde la interfaz; y la prueba de errores y recuperación. El recorrido de extremo a extremo en producción **no está aprobado formalmente**.

## 16. Education & Human Potential

El potencial humano se desperdicia sobre todo por desajuste, no por falta de capacidad: contenido demasiado difícil produce abandono, y contenido demasiado fácil produce estancamiento. Ese ajuste, hecho bien, requiere una atención individual y continua que el tiempo docente no alcanza a cubrir.

Lo que este proyecto explora es si un modelo de lenguaje puede sostener esa atención de forma responsable — decidiendo qué conviene a continuación y **explicando por qué**, con la calificación en manos de la base de datos, los datos aislados por usuario y una frontera explícita frente a cualquier interpretación clínica. La explicación importa tanto como la decisión: un sistema que solo dijera «ahora nivel 3» sería una caja negra; uno que además dice qué observó y qué habilidad prioriza es una herramienta que un docente puede supervisar y corregir.

---

## In English

**Problem.** In a classroom of thirty, everyone gets the same exercise at the same time. Advanced students disengage; struggling students accumulate gaps that go unnoticed. Real personalization requires someone to read each answer, understand *why* it failed, and decide what comes next — work that does not scale with available teaching time. The bottleneck is not content; it is **continuous, individualized pedagogical decision-making**.

**Solution.** A web application where a student takes a short 12-question diagnostic, receives a learning profile generated by Google Gemini, and then practices math and language exercises whose **difficulty and subject are chosen by Gemini after every single answer**, based on the accumulated evidence the student produces.

**Why Gemini is essential.** Gemini is not decoration — it is the decision engine. It determines the learning style, the initial level, the analysis of each response (strengths, difficulties, priority skill), the recommended next level, the next subject, and the pedagogical approach. Every call receives the base profile, the *previous analysis*, and the full attempt history, so the reasoning is cumulative rather than one-shot. Two boundaries are deliberate: grading is done by PostgreSQL, not by the model, because correctness is a verifiable fact; and if Gemini fails, the app says so instead of inventing a fallback recommendation and presenting it as an AI decision.

**Current MVP status.** The full flow — sign-up, email confirmation, login, diagnostic, real Gemini profile, and two consecutive adaptive iterations with persisted analyses — has been demonstrated in real execution, including a level increase after a correct answer and a subject switch decided by the model. Locally, typecheck, lint, production build, and **389 automated tests** all pass. The current version is **deployed and live** at https://proyecto-gemini-phi.vercel.app: an anonymous smoke test confirmed all seven public pages return 200 and that both API endpoints reject unauthenticated requests with a clean 401, without creating any account or touching any data. Still pending: the full authenticated walkthrough in production, a set of authenticated remote checks including cross-account isolation, and interface-level idempotency and error-recovery testing. The end-to-end run in production is **not formally approved yet**.

**This is not a medical tool.** The generated profile is educational guidance only — never a medical, clinical, psychological, or therapeutic assessment. Clinical vocabulary is rejected in two independent layers, in TypeScript and in PostgreSQL.
