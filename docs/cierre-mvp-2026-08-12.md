# Cierre del MVP — 12 de agosto de 2026

Documento de consolidación para el hackathon **Build with Gemini / XPRIZE**, categoría Education & Human Potential.

Resume qué está terminado, con qué evidencia, qué se validó hoy, qué falta y cómo comprobarlo. No contiene claves, valores de configuración ni identificadores de usuario.

**Estado en una línea:** el MVP está completo, validado localmente y documentado; **no está desplegado**, y por tanto el recorrido de extremo a extremo en producción **no está aprobado**.

---

## 1. Funcionalidades terminadas

| Funcionalidad | Estado |
|---|---|
| Registro, confirmación por correo e inicio de sesión | Terminada |
| Diagnóstico inicial de 12 preguntas | Terminada |
| Perfil generado con una llamada **real** a Gemini y persistido | Terminada |
| Vista del perfil, releído y revalidado desde la base de datos | Terminada |
| Actividad única con selección determinista (`/actividad`) | Terminada |
| Ciclo adaptativo completo con Gemini decidiendo tras cada respuesta (`/ciclo`) | Terminada |
| Conservación de intentos y de análisis adaptativos | Terminada |
| Ajuste de nivel y de materia decidido por el modelo | Terminada |
| Progreso básico | Terminada |
| Aislamiento por Supabase Auth + RLS | Terminada |
| Prevención de envíos múltiples en interfaz, API y base de datos | Terminada |
| Estados de carga, error y recuperación | Terminada hoy |

Fuera de alcance y no construido, según `CLAUDE.md` §6: panel administrativo, analítica compleja, multidioma completo, pagos.

---

## 2. Evidencia existente

### Evidencia funcional real (contra Supabase remoto y Gemini real)

- `POST /api/perfil` devolvió **200** con una llamada real al proveedor; `perfil_detectado` quedó persistido con exactamente `estilo_aprendizaje`, `explicacion` y `nivel_sugerido`.
- Una cuenta limpia produjo perfil **lectoescritor, nivel 2**.
- **Dos interacciones consecutivas del ciclo:**

  | | Interacción 1 | Interacción 2 |
  |---|---|---|
  | Materia y nivel | matemáticas, nivel 2 | matemáticas, nivel 3 |
  | Resultado | correcta | correcta |
  | Análisis de Gemini | conservado | conservado |
  | Nivel recomendado | **3** (sube) | **3** (mantiene) |
  | Siguiente materia | matemáticas | **lenguaje** (cambia) |

- El segundo análisis **usó explícitamente** el análisis anterior y los dos intentos.
- Conteos conservados: `diagnosticos` **1**, `intentos` **2**, `analisis_adaptativos` **2**.
- Banco de **cinco ejercicios**: matemáticas niveles 1, 2 y 3; lenguaje niveles 1 y 2.
- **Ocho de doce controles remotos** demostrados: 2, 3, 6, 7, 8, 9, 11 y 12.

### Sobre las versiones de análisis 1 y 3

Se observaron las versiones **1 y 3**, no 1 y 2. **Es normal y no indica pérdida de datos.** La columna `version` es `IDENTITY`: garantiza que dos filas nunca compartan valor —que es lo único que el ciclo necesita para saber cuál es «el último análisis»— pero **no** garantiza una numeración sin huecos. El salto proviene de una prueba previa de idempotencia. Está documentado como comportamiento esperado en `src/app/api/adaptar/route.ts`.

### Evidencia de que la decisión la toma Gemini

Pensada para que el jurado no tenga que creerlo por fe:

- La interfaz muestra el análisis nuevo **junto al anterior**, señalando el nivel previo entre paréntesis cuando cambia.
- Al pie aparece **el modelo que respondió y cuántos milisegundos tardó**.
- La justificación del modelo cita su propio análisis anterior.
- La pantalla declara que **la corrección la hizo la base de datos**, no el modelo: el reparto de responsabilidades se dice en voz alta en vez de atribuir todo a la IA.

---

## 3. Pruebas ejecutadas hoy (12 de agosto de 2026)

| Comando | Resultado | Duración |
|---|---|---|
| `npx tsc --noEmit` | exit 0 | ~6 s |
| `npm run lint` | exit 0 | ~48 s |
| `node --test` (7 archivos) | **389/389 aprobadas**, 0 fallidas | ~1 s |
| `npm run build` | exit 0 — `/ciclo` y `/api/adaptar` en el manifiesto | ~27 s |
| `git diff --check` | exit 0 | — |

Ejecutadas dos veces: antes y después de la única corrección de código del día.

---

## 4. Limitaciones conocidas

Se declaran de forma explícita. Ninguna es un bloqueo para la entrega.

1. **Producción está desactualizada** y sirve una versión sin el ciclo adaptativo.
2. **`SUPABASE_SECRET_KEY` no está configurada en Vercel.** Sin ella, en producción los análisis se generarían pero no se conservarían — y la interfaz lo declararía en pantalla en vez de fingir lo contrario.
3. **La prevención de intentos duplicados no es transaccional.** Cubre el doble clic, el reintento de red y la recarga, pero dos peticiones verdaderamente simultáneas podrían crear dos filas. Cerrarlo exige un índice único, es decir una migración nueva, que **no se hará antes de la entrega**.
4. **El banco tiene solo 5 ejercicios**, de modo que el ciclo se agota rápido. La aplicación lo indica en vez de repetir contenido.
5. **La protección de rutas en el cliente es una capa de UX**, no de autorización. La autorización real la imponen siempre las policies RLS.
6. **La selección de la siguiente actividad prioriza el nivel sobre la materia** cuando el banco no tiene ambos. La interfaz declara si la coincidencia fue exacta.
7. **El retorno del enlace de confirmación de correo** no está validado de extremo a extremo; la cuenta queda utilizable, comprobado por el inicio de sesión posterior.
8. **El botón «Reintentar» corregido hoy** solo se ha validado localmente (tipos, lint, build); falta comprobarlo en el navegador contra producción.
9. **Las migraciones `0001`–`0006` constan como aplicadas** según la evidencia documental del Sprint D, pero hoy no se pudieron reverificar: la CLI de Supabase no está instalada en este equipo y instalarla estaba fuera de alcance.

---

## 5. Controles pendientes para el jueves

- **Controles remotos autenticados 1, 4, 5 y 10** — el guion completo está en `docs/plan-smoke-dia3-remoto.md`.
- **Aislamiento entre cuentas con una segunda sesión**: que una cuenta no pueda leer los diagnósticos, intentos ni análisis de otra. Requiere una segunda cuenta, que **no se ha creado**.
- **Idempotencia por interfaz**: doble clic en «Enviar respuesta» y recarga tras responder, comprobando que no se crea un segundo intento.
- **Smoke de errores y recuperación**: forzar un fallo del análisis y comprobar que el mensaje explica que el intento sí quedó registrado y que «Reintentar» recupera la pantalla.
- **Recorrido completo en producción**, de registro a segunda iteración del ciclo.

---

## 6. Comandos para ejecutar localmente

```bash
npm install
npm run dev            # http://localhost:3000

npx tsc --noEmit       # tipos
npm run lint           # ESLint
npm run build          # build de producción
npm start              # servir el build

# Pruebas (no hay script "test"; runner nativo de Node)
node --test \
  src/lib/auth/contrato.test.mjs \
  src/lib/diagnostico/contrato.test.mjs \
  src/lib/diagnostico/consulta.test.mjs \
  src/lib/actividad/contrato.test.mjs \
  src/lib/adaptativo/contrato.test.mjs \
  src/lib/adaptativo/ciclo.test.mjs \
  scripts/checkpoint5-intentos.test.mjs
```

Requiere un `.env.local` con `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` y `GEMINI_API_KEY`. Ver `.env.example`.

---

## 7. Smoke test en producción

**Precondición innegociable:** antes de este smoke deben haberse hecho, en este orden, (a) configurar `SUPABASE_SECRET_KEY` en Vercel y (b) desplegar la versión actual. Desplegar sin la variable produciría una demo peor que la actual.

### 7.1 Comprobaciones sin cuenta (anónimas)

| Comprobación | Esperado |
|---|---|
| `GET /` | 200 |
| `GET /diagnostico` | 200 |
| `GET /ciclo` | **200** (hoy da 404) |
| `POST /api/perfil` sin token | **401** |
| `POST /api/adaptar` sin token | **401** (hoy da 404) |

El cambio de 404 a 401 en `/api/adaptar` es la señal de que el despliegue incluyó el ciclo.

### 7.2 Recorrido con una cuenta nueva

Usar una cuenta **nueva**, nunca la que ya tiene el diagnóstico y los dos intentos conservados.

1. Registro con un correo real → mensaje de confirmación pendiente.
2. Confirmar desde el enlace del correo y volver a la aplicación.
3. Iniciar sesión → pantalla de sesión activa.
4. Responder las 12 preguntas → aparece el perfil con estilo, nivel y explicación.
5. Recargar `/perfil` → el perfil sobrevive.
6. «Iniciar ciclo adaptativo» → responder.
7. Verificar en pantalla: veredicto, análisis completo, nivel recomendado, siguiente materia y enfoque, y al pie el modelo y los milisegundos.
8. **Verificar que NO aparece el aviso amarillo** «todavía no se pudo conservar». Si aparece, `SUPABASE_SECRET_KEY` no quedó bien configurada.
9. «Continuar con la siguiente actividad» → responder de nuevo.
10. Verificar que el segundo análisis **cita el anterior** y que el nivel o la materia cambian de forma justificada.
11. Doble clic rápido en «Enviar respuesta» → debe registrarse un solo intento.
12. Recargar a mitad del ciclo → debe mostrarse el estado ya registrado, nunca el formulario otra vez.

### 7.3 Aislamiento

Con una segunda cuenta nueva, comprobar que no ve el perfil, los intentos ni los análisis de la primera.

---

## 8. Preparación pendiente del hackathon

Nada de esto depende del código, y es lo que queda más atrasado.

| Entregable | Estado |
|---|---|
| **Video público menor de tres minutos** | Pendiente. Grabar contra producción ya actualizada, mostrando el recorrido completo y las dos iteraciones del ciclo con el cambio de nivel y de materia |
| **Narrativa en inglés o con traducción adecuada** | Parcial. El `README.md` incluye ya una sección en inglés (problem, solution, why Gemini is essential, current MVP status); falta la narrativa o presentación formal |
| **Validación piloto con usuarios reales** | Pendiente. Hay una cuenta real con recorrido completo; falta el círculo de prueba y la recolección de feedback |
| **P&L básico** | Pendiente. Proyección simple de ingresos y de gastos operativos: Vercel, Supabase, Gemini API y dominio |
| **Comprobación final de accesibilidad pública** | Pendiente. Abrir la URL desde una ventana sin sesión y sin cuenta de Vercel, confirmando que el jurado no encuentra ninguna pantalla de autenticación de la plataforma de hosting |
| **Repositorio sin secretos** | Verificado hoy: no hay ningún archivo sensible versionado |
| **Instrucciones reproducibles** | Cubiertas en el `README.md` |
| **Limitaciones declaradas honestamente** | Cubiertas en el `README.md` §14 y en este documento §4 |

**Fecha límite:** 17 de agosto de 2026, 3:00 p. m. de Bogotá.

---

## 9. Lo que NO se declara aprobado

Se dice de forma explícita para que nadie lo lea de más:

- **Las fases E y G no están aprobadas formalmente.**
- **El recorrido de extremo a extremo en producción no está aprobado**, porque no se ha ejecutado.
- Lo validado el 12 de agosto es **local**. Lo demostrado antes de esa fecha ocurrió contra **Supabase remoto**, pero **no** contra la aplicación desplegada. Son cosas distintas y se mantienen separadas a propósito.
