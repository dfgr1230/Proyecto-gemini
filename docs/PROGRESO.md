# PROGRESO.md — Estado actual del proyecto

Este archivo se actualiza al cierre de cada día de trabajo. Refleja el estado real más reciente del proyecto.

---

## Estado general

| Día | Estado |
|---|---|
| **Día 1 — Cimientos** | ✅ 100% completado |
| Día 2 — Datos y login | 🟨 En progreso — Checkpoints 2, 3 y 4 aprobados con evidencia real; Checkpoint 5 (intentos) INCONCLUSO tras dos ejecuciones reales (ver cierre de jornada 06-ago-2026); integración Next.js–Supabase implementada en el árbol de trabajo, pendiente de validación en ejecución; Checkpoint 6 y cierre del Día 2 no iniciados |
| Día 3 — Test de diagnóstico | ⬜ Pendiente |
| Día 4 — Conectar la IA | ⬜ Pendiente |
| Día 5 — Ciclo adaptativo | ⬜ Pendiente |
| Día 6 — Pulido + prueba real | ⬜ Pendiente |
| Día 7 — Cierre | ⬜ Pendiente |

---

## Día 1 — Cimientos (✅ completado)

- [x] Proyecto Next.js inicializado en la raíz (App Router, TypeScript, Tailwind CSS).
- [x] `CLAUDE.md` y `RULES.md` preservados sin modificar durante la inicialización.
- [x] Repositorio Git local creado, con historial de commits limpio.
- [x] `.gitignore` configurado: bloquea `.env*` para nunca subir claves reales, con excepción explícita para `.env.example`.
- [x] `.env.example` creado como plantilla, con las variables:
  - `GEMINI_API_KEY`
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [x] Compilación verificada sin errores ni advertencias (`npm run build`).
- [x] Raíz del workspace fijada en `next.config.ts` para evitar ambigüedad con otros proyectos en `D:\dev`.

**En proceso (fuera del código, a cargo del usuario):**
- Subir el repositorio a una cuenta de GitHub del usuario (repo nuevo).
- Enlazar ese repositorio en Vercel para obtener la URL pública.
- Las variables de entorno en Vercel se están configurando **en blanco por el momento** (se completarán con las claves reales de Gemini y Supabase en el Día 2 y Día 4).

---

## Siguiente paso exacto: Día 2 — Datos y login

1. Crear el proyecto en **Supabase**.
2. Crear las 4 tablas definidas en `CLAUDE.md` §3:
   - `usuarios`
   - `diagnosticos`
   - `ejercicios`
   - `intentos`
3. Activar **login por email** con Supabase Auth.
4. Conectar Next.js con Supabase (registro / inicio de sesión funcionando de extremo a extremo).

---

---

## Cierre de jornada — 23 de julio de 2026 — Fase 2

**Estado: Fase 2 (Día 2 — Datos y login) en progreso, aproximadamente 60% completada.**

### Confirmado hoy

- [x] Migración definitiva de la Parte A diseñada, corregida y revisada (varias iteraciones de endurecimiento: separación de `ejercicios`/`ejercicios_respuestas`, RPC `registrar_intento` con cálculo de `correcto` en el servidor, `search_path` sin `public` en funciones `SECURITY DEFINER`, validación estructural de `diagnosticos.respuestas`).
- [x] Migración guardada en el repositorio: `supabase/migrations/0001_dia2_esquema_base.sql`.
  - Líneas: 385
  - Bytes: 14.846
  - SHA-256: `4402d8ce5e6183684abc333c1ecd4e9501f27ce9977041f65f09ad6ea303bc25`
- [x] Diagnóstico de solo lectura ejecutado **antes** de migrar: sin objetos incompatibles en Supabase.
- [x] Migración ejecutada manualmente en el proyecto correcto de Supabase → `Success. No rows returned`.
- [x] Diagnóstico de solo lectura ejecutado **después** de migrar, confirmando:
  - Tablas: `public.usuarios`, `public.diagnosticos`, `public.ejercicios`, `public.ejercicios_respuestas`, `public.intentos`.
  - Funciones: `public.es_respuestas_diagnostico_valido(jsonb)`, `public.handle_new_user()`, `public.registrar_intento(uuid, text, integer)`.
  - Trigger: `on_auth_user_created` sobre `auth.users`.
  - RLS habilitado en las cinco tablas; políticas, columnas y restricciones creadas según lo diseñado.
- [x] `dia2_perfil_futuro.sql` permanece **fuera del repositorio** y **no fue ejecutado** — corresponde a la integración con Gemini de una etapa posterior.

### Pendiente para completar la Fase 2

La base de datos existe y está verificada estructuralmente, pero todavía falta demostrar con pruebas funcionales reales que se comporta como se diseñó, y conectarla con Next.js.

**Primera tarea de mañana — batería de pruebas funcionales**, con usuarios reales de Supabase Auth, verificando:
1. Creación de un usuario real vía Supabase Auth.
2. Creación automática de su fila en `public.usuarios` por el trigger.
3. Aislamiento de datos entre usuarios mediante RLS.
4. Inserción de un diagnóstico válido (10 a 15 respuestas).
5. Rechazo de diagnósticos inválidos.
6. Bloqueo de un segundo diagnóstico para el mismo usuario.
7. Imposibilidad de que un estudiante lea `public.ejercicios_respuestas`.
8. Registro de un intento mediante `registrar_intento()`.
9. Cálculo de `correcto` hecho por la base de datos, sin confiar en el cliente.
10. Rechazo de operaciones sin autenticación o con permisos indebidos.

**Después de las pruebas funcionales (si todas pasan):**
- Cargar ejercicios iniciales y sus respuestas oficiales.
- Instalar/configurar el cliente de Supabase en Next.js.
- Configurar las variables de entorno (incluye el nombre correcto `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`).
- Desarrollar registro, inicio de sesión, cierre de sesión y persistencia.
- Probar el flujo completo desde la interfaz.
- Ejecutar `npm run build`.
- Actualizar esta documentación.
- Hacer commit y push.
- Verificar el deployment.

---

## Cierre de jornada — 3 de agosto de 2026 — Checkpoint 2 (autenticación y trigger)

**Estado: Checkpoint 2 aprobado, con las salvedades documentadas más abajo.** No se declara completa la Fase 2: quedan pendientes el resto de la batería de pruebas funcionales y la conexión con Next.js.

### Validado con evidencia real

Usando dos usuarios temporales de prueba creados mediante el flujo real de Supabase Auth (correos y contraseñas no se registran en este documento ni en ningún archivo del repositorio):

- [x] Registro (`signUp`) incluyendo `options.data.nombre`, aceptado por Supabase Auth.
- [x] Confirmación de correo real mediante el enlace enviado por Supabase.
- [x] Inicio de sesión posterior a la confirmación, exitoso para ambos usuarios.
- [x] `auth.getUser()` devuelve la identidad esperada, con el correo marcado como confirmado.
- [x] El trigger `handle_new_user()` creó automáticamente la fila correspondiente en `public.usuarios` para ambos usuarios, con `id`, `nombre` y `email` coincidentes con la sesión.
- [x] Lectura del propio perfil (política `usuarios_select_propio`, RLS) exitosa para ambos usuarios.
- [x] Cierre de sesión (`signOut`) correcto.

### Salvedades

- El bloqueo de inicio de sesión previo a confirmar el correo (Confirm email activado) quedó demostrado limpiamente solo con el primer usuario temporal; en la repetición con el segundo, esa evidencia quedó contaminada porque el enlace de confirmación se abrió alrededor de ese mismo paso. No se considera necesario un tercer usuario para repetirla: Confirm email es una configuración global del proyecto, no específica de cada usuario, y ya quedó demostrada una vez de forma limpia e inequívoca.
- La redirección posterior a confirmar el correo apunta actualmente a una URL no operativa (previsiblemente una URL de redirección de desarrollo/localhost sin configurar todavía). Esto no invalida Auth ni el trigger. Queda pendiente de resolver cuando exista una URL real de la aplicación Next.js a la que redirigir — es decir, en la fase de conexión Next.js–Supabase, que todavía no ha comenzado.
- Todavía no se ha probado el aislamiento de datos entre usuarios mediante RLS (que un usuario no pueda leer el perfil de otro) — solo se validó la lectura del propio perfil.

### Correcciones técnicas verificadas durante el checkpoint

Aplicadas únicamente a `scripts/checkpoint2-auth-trigger.mjs` (utilidad de prueba temporal, no forma parte de la aplicación ni de la base de datos):

- La captura oculta de contraseña no reanudaba el flujo de entrada estándar al terminar, lo que cerraba el proceso apenas se intentaba continuar el menú después de ese paso. Corregido para que la entrada estándar quede correctamente reanudada.
- El adaptador de red usado por el script (para evitar una falla intermitente de conectividad detectada en este equipo) perdía silenciosamente los encabezados de autenticación (`apikey`, `Authorization`) cuando el SDK los entregaba mediante el tipo de objeto nativo de encabezados HTTP, en vez de un objeto simple — esto afectaba las consultas a la base de datos, no las llamadas de autenticación. Corregido para reconocer y combinar correctamente ese tipo de objeto, además de mapas, listas de pares y objetos simples, respetando la precedencia esperada.

### Siguiente pendiente

Punto 3 de la batería de pruebas funcionales: **aislamiento de datos entre usuarios mediante RLS** (Checkpoint 3, en la numeración de sesión usada para organizar esta batería). Los dos usuarios temporales de prueba se conservan intencionalmente para esa prueba, y se eliminarán inmediatamente después de concluirla.

---

## Cierre de jornada — 3 de agosto de 2026 — Checkpoint 3 (aislamiento de perfiles mediante RLS)

**Estado: Checkpoint 3 aprobado.** No se declara completa la Fase 2 ni el Día 2: quedan pendientes el resto de la batería de pruebas funcionales y la conexión con Next.js.

### Utilidad creada

- [x] Se creó `scripts/checkpoint3-rls-aislamiento.mjs` como utilidad **hermana** de `scripts/checkpoint2-auth-trigger.mjs`, sin modificar este último (permanece intacto).
- [x] Validación local antes de usarla contra Supabase real: sintaxis (`node --check`), lógica de clasificación de resultados probada con datos ficticios (sin red), y ocultamiento de contraseña verificado sobre el script real (abortando antes de cualquier llamada a Supabase).

### Diseño de la prueba

La prueba trabajó con dos identidades de forma secuencial (nunca dos sesiones simultáneas), usando en todo momento el **cliente público autenticado** (nunca `service_role`):

1. Usuario 1 inicia sesión y consulta su propio perfil (sin filtro explícito; RLS restringe).
2. Usuario 2 inicia sesión, consulta su propio perfil, y luego —con esa misma sesión— consulta explícitamente el perfil del Usuario 1 por su identificador.
3. Usuario 1 vuelve a iniciar sesión (con las credenciales ya en memoria) y consulta explícitamente el perfil del Usuario 2.

Cero filas en una consulta cruzada, sin error, se interpretó explícitamente como **bloqueo correcto de RLS** (éxito), nunca como fallo. Un error técnico (red, transporte o autenticación) se distinguió expresamente de un bloqueo válido y nunca se interpretó como aislamiento confirmado.

### Resultado de la ejecución definitiva

Las cuatro aserciones fueron **aprobadas**:

- [x] Usuario 1 pudo consultar exactamente su propio perfil.
- [x] Usuario 1 no pudo obtener el perfil del Usuario 2 (consulta cruzada: cero filas, sin error).
- [x] Usuario 2 pudo consultar exactamente su propio perfil.
- [x] Usuario 2 no pudo obtener el perfil del Usuario 1 (consulta cruzada: cero filas, sin error).

**Resultado global: APROBADO.**

### Incidencia transitoria (no es un defecto de RLS)

Una primera ejecución quedó **inconclusa**: el primer intento de inicio de sesión del Usuario 1 devolvió `status 0` y mensaje vacío. Dentro de esa misma ejecución, ese mismo usuario logró autenticarse en un intento posterior. Al repetir el procedimiento completo desde el inicio, todas las operaciones funcionaron correctamente y se obtuvo la evidencia definitiva reportada arriba.

Este episodio se registra como una **incidencia transitoria de autenticación o transporte**, no como un defecto de la política RLS ni de la lógica de aislamiento — la propia repetición exitosa, junto con el patrón ya observado en el Checkpoint 2 (errores de red intermitentes en este equipo, ver esa sección), es coherente con esa clasificación. No se documenta ninguna causa técnica específica para este episodio puntual por no haber evidencia que la sustente.

### Limpieza confirmada

- [x] Las dos cuentas temporales se eliminaron manualmente desde el panel de Supabase (Authentication → Users).
- [x] Se verificó en Table Editor → `public.usuarios` que la tabla quedó sin las filas relacionadas.
- [x] Esto confirma con evidencia funcional real que la relación `public.usuarios.id → auth.users.id` con `ON DELETE CASCADE` (definida en la migración) opera correctamente.
- [x] No quedan cuentas ni perfiles temporales de los Checkpoints 2 o 3.

### Tratamiento de `scripts/checkpoint3-rls-aislamiento.mjs`

Se conserva como utilidad de diagnóstico reutilizable (igual criterio que con el script de Checkpoint 2), no como código desechable.

### Siguiente pendiente

**Checkpoint 4**: punto 4-6 de la batería de pruebas funcionales (creación de un diagnóstico válido, rechazo de diagnósticos inválidos, bloqueo de un segundo diagnóstico por usuario). El alcance exacto se definirá mediante inspección directa de `supabase/migrations/0001_dia2_esquema_base.sql` antes de implementar cualquier prueba.

---

## Cierre de jornada — 6 de agosto de 2026 — Checkpoint 4 (diagnósticos) y Checkpoint 5 (intentos, inconcluso)

**Estado: Checkpoint 4 aprobado. Checkpoint 5 permanece INCONCLUSO tras dos ejecuciones reales — no está aprobado ni reprobado.** No se declara completa la Fase 2 ni el Día 2. No se ha iniciado el Checkpoint 6 ni el Día 3.

Nota de trazabilidad: esta entrada se registra el 6 de agosto de 2026, consolidando en este documento resultados de sesiones de trabajo previas cuya fecha, hora exacta y detalle punto por punto no quedaron registrados en este archivo al momento de ocurrir. Donde el detalle exacto no está disponible, se documenta únicamente el resultado confirmado, sin reconstruir circunstancias no respaldadas.

### Checkpoint 4 — diagnósticos

- [x] Checkpoint 4 aprobado (puntos 4-6 de la batería funcional: diagnóstico válido, rechazo de diagnósticos inválidos, bloqueo de un segundo diagnóstico por usuario — alcance definido al cierre del Checkpoint 3).
- [x] Existe un diagnóstico válido del Usuario Temporal A, que debe conservarse y no debe leerse, modificarse, duplicarse ni eliminarse en las fases siguientes.

### Checkpoint 5 — registro de intentos (`registrar_intento()`), INCONCLUSO

Utilidad: `scripts/checkpoint5-intentos.mjs` (con lógica pura en `scripts/lib/checkpoint5-logica.mjs`, cubierta por 96 pruebas locales en `scripts/checkpoint5-intentos.test.mjs`, aprobadas sin red).

- Ejecuciones reales realizadas: **exactamente dos**, ambas **INCONCLUSAS**.
- Primera ejecución: terminó inconclusa por rechazo del login inicial. La causa técnica exacta de ese primer rechazo no quedó demostrada con evidencia disponible.
- Segunda ejecución: terminó inconclusa por rechazo del login inicial, con:
  - `status: 400`
  - `code: invalid_credentials`
  - mensaje: `Invalid login credentials`
- En ambas ejecuciones, el fallo ocurrió durante la autenticación del Usuario Temporal A, **antes** de cualquier operación sobre `registrar_intento()` o `public.intentos`.
- Llamadas reales a `registrar_intento()` en las dos ejecuciones: **cero**.
- Filas creadas por el Checkpoint 5 en `public.intentos` en las dos ejecuciones: **cero**.
- No se atribuye el rechazo de credenciales a ninguna causa específica (contraseña, error de tipeo, la cuenta, Supabase u otra causa): no hay evidencia que lo demuestre.
- **Checkpoint 5 no está aprobado ni reprobado: permanece INCONCLUSO.**
- No existe una tercera ejecución. No se ha autorizado ni realizado.

### Integración Next.js–Supabase

- [x] Implementada en el árbol de trabajo: cliente público (`src/lib/supabase/client.ts`), contrato de autenticación (`src/lib/auth/contrato.ts`, con pruebas propias), páginas y componentes de registro, login, confirmación de correo y reenvío de confirmación (`src/app/login/`, `src/app/registro/`, `src/app/auth/callback/`, `src/components/auth/`).
- Esta integración **todavía no está validada en ejecución real** (no hay, en este documento, evidencia de una prueba de flujo completo desde la interfaz contra Supabase). No se declara funcional hasta que exista esa validación.

### Siguiente pendiente

Un **diagnóstico de autenticación independiente y no mutante**, enfocado específicamente en el rechazo repetido de credenciales del Usuario Temporal A observado en las dos ejecuciones del Checkpoint 5. Este diagnóstico es un paso separado de una eventual tercera ejecución del Checkpoint 5 — no la sustituye ni la autoriza. El Checkpoint 6 y el Día 3 no comienzan hasta que el Checkpoint 5 quede aprobado.

---

*Última actualización: cierre de jornada del 6 de agosto de 2026. Checkpoints 2, 3 y 4 aprobados con evidencia real; Checkpoint 5 INCONCLUSO tras dos ejecuciones reales (rechazo de credenciales en la autenticación inicial de ambas; cero llamadas a `registrar_intento()`; cero filas creadas en `public.intentos`). La integración Next.js–Supabase está implementada en el árbol de trabajo pero no validada en ejecución. Checkpoint 6 y Día 3 no iniciados. No existe una fórmula documentada de avance por porcentaje: las estimaciones cualitativas de entradas anteriores no se extienden a esta entrada por no poder respaldarse con precisión adicional en este momento.*
