# PROGRESO.md — Estado actual del proyecto

Este archivo se actualiza al cierre de cada día de trabajo. Refleja el estado real más reciente del proyecto.

---

## Estado general

| Día | Estado |
|---|---|
| **Día 1 — Cimientos** | ✅ 100% completado |
| **Día 2 — Datos y login** | ✅ 100% completado — cerrado el 7 de agosto de 2026. Checkpoints 2, 3, 4 y 5 aprobados con evidencia real; Checkpoint 6 (6A local + 6B funcional remoto) APROBADO Y CERRADO. Ver la sección "Checkpoint 6" para el alcance validado y sus limitaciones |
| Día 3 — Test de diagnóstico | 🟨 En progreso — recorrido local implementado y validado (F1-A1), endurecido en F1-A1R y F1-A1R2. Pendiente: aplicar `0004` y ejecutar una llamada real a Gemini (compuerta F1-A2) |
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

## Cierre de jornada — 6 de agosto de 2026 — Checkpoint 4 (diagnósticos) y Checkpoint 5 (intentos, inconcluso en esa fecha)

> ⚠️ **ESTADO HISTÓRICO SUPERADO.** Esta entrada refleja la situación tal como era el 6 de agosto de 2026 y se conserva íntegra como registro de trazabilidad. Lo que aquí se afirma sobre el Checkpoint 5 (INCONCLUSO, dos ejecuciones, cero llamadas, cero filas) **dejó de ser el estado vigente** el 7 de agosto de 2026. El estado final y autoritativo del Checkpoint 5 es **APROBADO**, y está registrado en la sección "Cierre del Checkpoint 5" más abajo. Ante cualquier discrepancia, prevalece esa sección posterior.

**Estado en esa fecha: Checkpoint 4 aprobado. Checkpoint 5 permanecía INCONCLUSO tras dos ejecuciones reales — no estaba aprobado ni reprobado.** No se declaraba completa la Fase 2 ni el Día 2. No se había iniciado el Checkpoint 6 ni el Día 3.

Nota de trazabilidad: esta entrada se registra el 6 de agosto de 2026, consolidando en este documento resultados de sesiones de trabajo previas cuya fecha, hora exacta y detalle punto por punto no quedaron registrados en este archivo al momento de ocurrir. Donde el detalle exacto no está disponible, se documenta únicamente el resultado confirmado, sin reconstruir circunstancias no respaldadas.

### Checkpoint 4 — diagnósticos

- [x] Checkpoint 4 aprobado (puntos 4-6 de la batería funcional: diagnóstico válido, rechazo de diagnósticos inválidos, bloqueo de un segundo diagnóstico por usuario — alcance definido al cierre del Checkpoint 3).
- [x] Existe un diagnóstico válido del Usuario Temporal A, que debe conservarse y no debe leerse, modificarse, duplicarse ni eliminarse en las fases siguientes.

### Checkpoint 5 — registro de intentos (`registrar_intento()`), INCONCLUSO **al 6 de agosto de 2026**

*(Registro histórico. Superado por el "Cierre del Checkpoint 5" del 7 de agosto de 2026 — ver más abajo. Las cifras de esta subsección describen únicamente las dos primeras de las cinco ejecuciones que finalmente se realizaron.)*

Utilidad: `scripts/checkpoint5-intentos.mjs` (con lógica pura en `scripts/lib/checkpoint5-logica.mjs`, cubierta por 96 pruebas locales en `scripts/checkpoint5-intentos.test.mjs`, aprobadas sin red).

- Ejecuciones reales realizadas **hasta esa fecha**: **dos**, ambas **INCONCLUSAS**.
- Primera ejecución: terminó inconclusa por rechazo del login inicial. La causa técnica exacta de ese primer rechazo no quedó demostrada con evidencia disponible.
- Segunda ejecución: terminó inconclusa por rechazo del login inicial, con:
  - `status: 400`
  - `code: invalid_credentials`
  - mensaje: `Invalid login credentials`
- En ambas ejecuciones, el fallo ocurrió durante la autenticación del Usuario Temporal A, **antes** de cualquier operación sobre `registrar_intento()` o `public.intentos`.
- Llamadas reales a `registrar_intento()` **en esas dos ejecuciones**: **cero**.
- Filas creadas por el Checkpoint 5 en `public.intentos` **en esas dos ejecuciones**: **cero**.
- No se atribuye el rechazo de credenciales a ninguna causa específica (contraseña, error de tipeo, la cuenta, Supabase u otra causa): no hay evidencia que lo demuestre.
- **Al 6 de agosto de 2026, el Checkpoint 5 no estaba aprobado ni reprobado: permanecía INCONCLUSO.** *(Superado: quedó APROBADO el 7 de agosto de 2026.)*
- A esa fecha no existía una tercera ejecución. *(Superado: se realizaron tres ejecuciones adicionales — la tercera, la cuarta y la quinta — todas registradas en el "Cierre del Checkpoint 5".)*

### Integración Next.js–Supabase

- [x] Implementada en el árbol de trabajo: cliente público (`src/lib/supabase/client.ts`), contrato de autenticación (`src/lib/auth/contrato.ts`, con pruebas propias), páginas y componentes de registro, login, confirmación de correo y reenvío de confirmación (`src/app/login/`, `src/app/registro/`, `src/app/auth/callback/`, `src/components/auth/`).
- Esta integración **todavía no está validada en ejecución real** (no hay, en este documento, evidencia de una prueba de flujo completo desde la interfaz contra Supabase). No se declara funcional hasta que exista esa validación.

### Siguiente pendiente **según se planificó el 6 de agosto de 2026**

*(Registro histórico. El plan que sigue se ejecutó y quedó superado: ver "Cierre del Checkpoint 5".)*

Un **diagnóstico de autenticación independiente y no mutante**, enfocado específicamente en el rechazo repetido de credenciales del Usuario Temporal A observado en las dos primeras ejecuciones del Checkpoint 5. Este diagnóstico es un paso separado de una eventual tercera ejecución del Checkpoint 5 — no la sustituye ni la autoriza. El Checkpoint 6 y el Día 3 no comienzan hasta que el Checkpoint 5 quede aprobado.

---

*Fin del registro del 6 de agosto de 2026. En esa fecha: Checkpoints 2, 3 y 4 aprobados con evidencia real; Checkpoint 5 INCONCLUSO tras dos ejecuciones reales (rechazo de credenciales en la autenticación inicial de ambas; cero llamadas a `registrar_intento()`; cero filas creadas en `public.intentos`). La integración Next.js–Supabase estaba implementada en el árbol de trabajo pero no validada en ejecución. Checkpoint 6 y Día 3 no iniciados. No existe una fórmula documentada de avance por porcentaje: las estimaciones cualitativas de entradas anteriores no se extienden a esa entrada por no poder respaldarse con precisión adicional.*

***Todo lo anterior a esta línea corresponde a estados históricos. El estado final aceptado del proyecto comienza en la sección siguiente.***

---

## Cierre del Checkpoint 5 — 7 de agosto de 2026 — **APROBADO**

**Estado final y autoritativo: Checkpoint 5 APROBADO.** Esta sección sustituye, para todos los efectos, cualquier afirmación anterior de este documento que describa el Checkpoint 5 como inconcluso, o que hable de "dos ejecuciones", "cero llamadas a `registrar_intento()`" o "cero filas en `public.intentos`". Aquellas afirmaciones eran correctas en su fecha y se conservan arriba únicamente como trazabilidad.

### Cronología completa: cinco ejecuciones controladas

Se realizaron **exactamente cinco** ejecuciones de `scripts/checkpoint5-intentos.mjs`, en este orden:

| N.º | Resultado | Punto alcanzado |
|---:|---|---|
| 1 | INCONCLUSA | Rechazo del login inicial. Intento de diagnóstico; causa técnica exacta no demostrada. |
| 2 | INCONCLUSA | Rechazo del login inicial (`status 400`, `invalid_credentials`). Sin llegar a `registrar_intento()`. |
| 3 | `precondicion_incumplida` | Superó la autenticación, pero `public.ejercicios` no contenía ninguna fila utilizable. |
| 4 | Error PostgreSQL `42702` | **Alcanzó `registrar_intento()`** y falló dentro de la función por ambigüedad de la columna `fecha`. |
| 5 | **EXITOSA** | Llamada válida a `registrar_intento()`, con respuesta válida de la función. |

### Migraciones aplicadas entre ejecuciones

- Tras la **tercera** ejecución se creó y se aplicó **exactamente una vez** `supabase/migrations/0002_dia2_seed_ejercicio_minimo.sql`, que desbloqueó la precondición de ejercicio.
- Tras la **cuarta** ejecución se creó y se aplicó **exactamente una vez** `supabase/migrations/0003_dia2_corregir_registrar_intento_fecha.sql`, que corrigió la ambigüedad de la columna `fecha` y eliminó el error `42702`.

**Nota sobre las cabeceras de `0002` y `0003`:** ambos archivos contienen en sus comentarios la leyenda "este archivo NO ha sido ejecutado / requiere autorización expresa posterior". Esa leyenda **describe el estado que tenían en el momento de crearse**, antes de recibir la autorización correspondiente. Fue superada por las aplicaciones descritas arriba. Las cabeceras **no se modifican deliberadamente**: las tres migraciones (`0001`, `0002`, `0003`) se tratan como **inmutables** una vez aplicadas, y sus hashes SHA-256 deben permanecer constantes. La aclaración de estado vive aquí, en el documento vivo, no dentro del archivo aplicado.

### Resultado de la quinta ejecución

- Ejecuciones de la quinta pasada: **exactamente una**.
- Llamadas válidas a `registrar_intento()`: **una**, con respuesta válida de la función.
- Filas creadas en `public.intentos`: **exactamente una**, válida.
- **Checkpoint 5: APROBADO.**

### Restricción operativa

**No se autoriza repetir la quinta ejecución**, ni ninguna ejecución adicional de `scripts/checkpoint5-intentos.mjs`. El checkpoint está cerrado y toda repetición crearía filas adicionales en `public.intentos` sin aportar evidencia nueva.

---

## Checkpoint 6 — Validación de la integración Next.js–Supabase

**Definido y completado el 7 de agosto de 2026. Estado final: Checkpoint 6A APROBADO Y CERRADO; Checkpoint 6B APROBADO Y CERRADO; Checkpoint 6 completo APROBADO Y CERRADO.**

### Objetivo

Validar la integración de autenticación ya implementada antes del cierre formal del Día 2.

### Checkpoint 6A — Validación local

- Auditoría estática de registro, callback de confirmación, login, persistencia, logout y protección de rutas.
- Ejecución de pruebas locales existentes relacionadas.
- Verificación local de tipos y lint cuando existan scripts específicos.
- `npm run build`.
- Cero contacto con Supabase real.

#### Cierre del Checkpoint 6A — APROBADO Y CERRADO (7 de agosto de 2026)

**Alcance validado localmente**

- Registro.
- Confirmación de correo.
- Login.
- Persistencia y comprobación local de sesión.
- Ruta protegida.
- Logout exitoso y logout fallido.

**Correcciones finales incorporadas antes del cierre**

- `src/components/auth/VistaProtegida.tsx` quedó segura frente a la doble ejecución de efectos en React Strict Mode: se retiró la guardia persistente `yaVerificado` y cada ejecución del efecto conserva su propia variable de cancelación local, de modo que la ejecución vigente siempre mantiene un manejador activo.
- `src/components/auth/ConfirmacionCorreo.tsx` reutiliza una única promesa de confirmación guardada en `useRef` y mantiene un manejador activo por cada ejecución del efecto, con cancelación local por ejecución.

**Evidencia final aceptada**

- 95/95 pruebas de autenticación aprobadas (`node --test src/lib/auth/contrato.test.mjs`).
- `npm run lint` exitoso.
- `npm run build` exitoso.
- `git diff --check` exitoso.
- Migraciones `0001`, `0002` y `0003` preservadas sin cambios (hashes SHA-256 idénticos antes y después de todo el trabajo del Checkpoint 6A).

**Naturaleza de las regresiones de Strict Mode**

Las regresiones que cubren el ciclo de vida de los efectos en React Strict Mode son **comprobaciones estructurales**: leen el texto fuente de los componentes y verifican la forma del código. **No ejecutan React ni montan los componentes**, porque el proyecto no incluye jsdom ni React Testing Library. Se aceptan acompañadas de `npm run lint` y `npm run build` satisfactorios, no como sustituto de una validación en ejecución.

**Límites explícitos de este cierre** *(tal como se registraron en el momento de cerrar 6A; los cuatro últimos quedaron superados ese mismo día por el cierre del Checkpoint 6B y del Día 2 — ver más abajo)*

- No hubo contacto con Supabase real durante el Checkpoint 6A. *(Sigue vigente: se refiere únicamente al alcance de 6A.)*
- El Checkpoint 6B no se ejecutó. *(Superado: 6B se ejecutó y quedó aprobado.)*
- El Checkpoint 6 completo todavía **no** está cerrado. *(Superado: cerrado.)*
- El Día 2 continúa **abierto**. *(Superado: cerrado.)*
- El Día 3 **no** está autorizado. *(Sigue vigente.)*

### Checkpoint 6B — Validación funcional remota

- Registro desde la interfaz.
- Confirmación de correo.
- Login.
- Persistencia tras recargar.
- Logout.
- Comprobación de rutas protegidas después del logout.

#### Cierre del Checkpoint 6B — APROBADO Y CERRADO (7 de agosto de 2026)

Evidencia funcional **ejecutada en navegador real** (Chrome), contra el proyecto Supabase real mediante la clave pública. Esta evidencia es de naturaleza distinta a la del Checkpoint 6A: allí las regresiones de Strict Mode fueron comprobaciones estructurales sobre el texto fuente; aquí se observó el comportamiento real de la aplicación en ejecución.

**1. Ruta protegida sin sesión**

- Apertura de `/`.
- Redirección correcta a `/login`.

**2. Registro**

- Una sola cuenta de prueba creada mediante el formulario público.
- Mensaje visible de registro aceptado y confirmación pendiente ("La cuenta fue creada correctamente. Revisa tu correo para confirmar la cuenta antes de iniciar sesión.").

**3. Confirmación**

- Correo de confirmación recibido.
- Enlace pulsado una sola vez.
- **El retorno a la aplicación local no se completó**: la pestaña abierta por el enlace mostró en Safari "no pudo conectarse al servidor".
- **No se observó ni se ejecutó localmente ningún `GET /auth/callback`**: la traza completa del servidor de desarrollo no contiene esa ruta.
- La confirmación quedó respaldada **indirectamente** por el login posterior exitoso con la misma cuenta.

**4. Login explícito**

- Autenticación exitosa.
- Navegación a `/`.
- Contenido de sesión activa visible ("Sesión iniciada / Tu sesión está activa.").

**5. Persistencia**

- Sesión conservada después de una recarga completa.
- Un acceso directo posterior a `/` mantuvo la sesión.

**6. Logout**

- Cierre de sesión exitoso.
- Navegación a `/login`.

**7. Protección posterior**

- Acceso directo a `/` después del logout redirigió a `/login`.
- La sesión no reapareció al recargar `/login`.

**Los siete casos quedaron APROBADOS.**

#### Limitación explícita del Caso 3 (confirmación de correo)

- **El callback local no quedó validado de extremo a extremo.**
- La aprobación del Caso 3 se basa en **evidencia funcional indirecta**: Supabase aceptó después el inicio de sesión de esa misma cuenta, lo que no ocurre con una cuenta sin confirmar.
- El fallo de retorno observado en Safari queda registrado como **limitación ambiental no diagnosticada**. No se investigó su causa ni se modificó configuración alguna para sortearlo.
- **No se afirma** que se haya demostrado la corrección de la configuración de Redirect URLs del proyecto Supabase.
- **`/auth/callback` no debe presentarse como ruta ejecutada satisfactoriamente**: no llegó a cargarse ni una sola vez durante el Checkpoint 6B.
- Esta limitación **no impidió** validar que la cuenta quedó utilizable, comprobado mediante el login posterior.

#### Efectos remotos producidos durante el Checkpoint 6B

- Se creó **una sola** cuenta de prueba.
- Se confirmó su correo.
- El perfil asociado **pudo** haber sido creado automáticamente por el trigger existente, pero **no se consultaron tablas** para verificarlo.
- La cuenta **permanece** en Supabase (eliminarla habría exigido una operación administrativa no autorizada).
- **No hubo ninguna otra modificación remota.**

#### Integridad del repositorio durante el Checkpoint 6B

- El estado Git inicial y final fue **idéntico**.
- **Ningún archivo del repositorio fue modificado** durante 6B.
- Las migraciones `0001`, `0002` y `0003` conservaron sus hashes SHA-256 sin cambio alguno.
- No se ejecutaron SQL, migraciones, RPC, pruebas, lint, build ni `npm install`.
- No se usaron `service_role`, Management API ni Dashboard administrativo.
- No se realizaron operaciones Git ni deployment.

### Condición de aprobación

El Checkpoint 6 solo se aprueba cuando 6A y 6B estén aprobados. El Checkpoint 6 no incluye SQL, migraciones, carga de datos, correcciones de código, commit, push, merge ni deployment. La aprobación del Checkpoint 6 no cierra automáticamente el Día 2.

**Condición cumplida el 7 de agosto de 2026**: 6A y 6B quedaron ambos aprobados, y el cierre del Día 2 se autorizó como decisión separada y explícita.

---

## Cierre del Día 2 — 7 de agosto de 2026

| Elemento | Estado |
|---|---|
| Checkpoint 2 — autenticación y trigger | **APROBADO** |
| Checkpoint 3 — aislamiento por RLS | **APROBADO** |
| Checkpoint 4 — diagnósticos | **APROBADO** |
| Checkpoint 5 — registro de intentos | **APROBADO** (quinta ejecución exitosa; ver "Cierre del Checkpoint 5") |
| Checkpoint 6A | **APROBADO Y CERRADO** |
| Checkpoint 6B | **APROBADO Y CERRADO** |
| Checkpoint 6 completo | **APROBADO Y CERRADO** |
| **Día 2 — Datos y login** | **APROBADO Y CERRADO** |
| Avance del Día 2 | **100 %** |
| Día 3 — Test de diagnóstico | **No iniciado ni autorizado** |

El 100 % corresponde exclusivamente al Día 2. **No se asigna un porcentaje global a la Fase 2**, porque el roadmap del proyecto no contiene una fórmula explícita para calcularlo.

Este cierre debe leerse junto con la limitación del Caso 3 registrada más arriba: el flujo de autenticación quedó validado funcionalmente de extremo a extremo **salvo** el retorno del callback de confirmación a la aplicación local, que no pudo comprobarse y permanece como limitación ambiental abierta. **`/auth/callback` no fue validada directamente de extremo a extremo.** Esta observación se mantiene abierta y **no invalida el cierre del Día 2**: la utilidad de la cuenta quedó demostrada por el inicio de sesión posterior con esa misma cuenta.

---

## Corrección documental y defensiva — 7 de agosto de 2026 (F0-C1R)

Ajuste de coherencia previo a consolidar el Día 2 en Git. No modifica el estado aprobado de ningún checkpoint.

- **`docs/PROGRESO.md`**: se unificó la cronología del Checkpoint 5. Las secciones anteriores al 7 de agosto quedan marcadas explícitamente como **estados históricos superados** y se añadió la sección "Cierre del Checkpoint 5" con las cinco ejecuciones, las dos migraciones aplicadas una sola vez cada una, y la restricción de no repetir la quinta ejecución.
- **`src/lib/auth/contrato.ts`**: `ejecutarLogin()` dejó de declarar `sesion_iniciada` por la sola ausencia de error. Ahora exige **evidencia positiva** de `data.session` —el mismo principio defensivo que `ejecutarRegistro()` ya aplicaba con `data.user`— y, si falta, devuelve un error con mensaje fijo y sanitizado. La clasificación y sanitización de errores del proveedor no se modificó.
- **`src/lib/auth/contrato.test.mjs`**: se añadió una prueba **conductual** que invoca realmente `ejecutarLogin()` con dependencias simuladas y comprueba que una respuesta `{ data: { session: null }, error: null }` **no** produce `sesion_iniciada`. Se actualizó el doble de la prueba de login exitoso preexistente para que incluya `session`, acorde al contrato reforzado.
- Registro, reenvío de confirmación, logout, confirmación de correo y protección de vistas **no fueron alterados**.
- Las migraciones `0001`, `0002` y `0003` **no fueron modificadas**: conservan sus hashes SHA-256.

---

## Día 3 — Diagnóstico y perfil Gemini — F1-A1 (7 de agosto de 2026)

**Estado: recorrido local implementado y validado. NO se ha ejecutado ninguna llamada real a Gemini, ni se ha aplicado la migración `0004`, ni se ha escrito nada en Supabase.**

Rama de trabajo: `feature/dia3-diagnostico-gemini`, creada desde el commit consolidado del Día 2 (`c227f97`). Sin commit ni push en esta compuerta.

### Qué quedó construido

- **Banco de 12 preguntas** (`src/lib/diagnostico/preguntas.ts`), de contenido exclusivamente educativo: preferencias de aprendizaje y autopercepción de dificultad. No se pregunta ni se infiere ninguna condición clínica, y no se solicita ningún dato personal.
- **Contrato del diagnóstico** (`src/lib/diagnostico/contrato.ts`): valida las respuestas (12 exactas, identificadores conocidos, opciones pertenecientes a su pregunta, sin texto libre) y valida el perfil con vocabulario cerrado.
- **Cliente de Gemini de servidor** (`src/lib/gemini/cliente.ts`): `fetch` nativo contra la API oficial, con salida estructurada (`responseMimeType` + `responseSchema`). Sin SDK: no se instaló ninguna dependencia.
- **Orquestación del perfil** (`src/lib/gemini/perfil.ts`): construye la instrucción y valida la respuesta. Parseo estricto con `JSON.parse`, sin extracción por expresiones regulares.
- **Ruta de servidor** (`src/app/api/perfil/route.ts`): autentica, valida, genera y persiste, en ese orden.
- **Interfaz** (`/diagnostico` + `FormularioDiagnostico.tsx`), protegida por la sesión existente, con progreso visible y reintento sin pérdida de respuestas.
- **Migración `0004`** (propuesta, **no ejecutada**): función de validación `es_perfil_detectado_valido()` y RPC `guardar_diagnostico_con_perfil()`.

### Decisiones que conviene recordar

- **Persistencia atómica y al final.** `diagnosticos.usuario_id` es UNIQUE y no existe policy de DELETE: si se insertaran las respuestas antes de generar el perfil, un fallo de Gemini dejaría ocupado el único diagnóstico permitido, sin perfil y sin forma de reintentar. Por eso se escriben respuestas y perfil juntos, y solo cuando el perfil ya es válido.
- **RPC en lugar de policy de UPDATE.** Abrir `UPDATE` sobre `perfil_detectado` permitiría al navegador escribir cualquier JSON en esa columna. La RPC `SECURITY DEFINER` concentra la escritura y valida la estructura dentro de la base de datos.
- **Sesión en el servidor sin `service_role`.** El navegador envía su `access_token` en la cabecera `Authorization`; el servidor lo valida con `getUser(token)` contra Supabase Auth y opera con la clave publicable, de modo que las policies RLS existentes siguen siendo la autorización real.
- **El perfil es una orientación educativa**, nunca un diagnóstico: solo estilo de aprendizaje, nivel sugerido (1-5, la misma escala de `ejercicios.nivel_dificultad`) y una explicación breve. Cualquier propiedad adicional se rechaza, y una explicación con vocabulario clínico invalida el perfil completo.

### Evidencia local

- `node --test src/lib/auth/contrato.test.mjs`: **96/96** aprobadas (sin regresiones).
- `node --test src/lib/diagnostico/contrato.test.mjs`: **46/46** aprobadas.
- `npm run lint` y `npm run build`: exitosos. `/api/perfil` se construye como ruta dinámica de servidor.
- Comprobado sobre el bundle generado: `GEMINI_API_KEY`, el endpoint de Gemini y el texto de la instrucción **no aparecen** en `.next/static`.
- Migraciones `0001`, `0002` y `0003`: hashes SHA-256 sin cambio.

### Pendiente (compuerta F1-A2)

Aplicar `0004` de forma controlada, cargar `GEMINI_API_KEY` en el entorno, y validar una llamada real a Gemini con persistencia real.

---

## Día 3 — F1-A1R: endurecimiento de la migración `0004` (7 de agosto de 2026)

**Estado: Día 3 sigue EN PROGRESO. `0004` continúa SIN APLICARSE. No hay llamada real a Gemini ni persistencia remota comprobada.**

Corrección local sobre lo construido en F1-A1. Rama `feature/dia3-diagnostico-gemini`, sin commit ni push.

### Hallazgo corregido: la barrera clínica solo existía en TypeScript

La primera versión de `0004` delegaba el filtro de vocabulario clínico exclusivamente en `src/lib/diagnostico/contrato.ts`, para no duplicar la lista. **Ese razonamiento era incorrecto.** La RPC `guardar_diagnostico_con_perfil()` está expuesta a `authenticated`, de modo que un usuario autenticado puede invocarla **directamente** —desde la consola del navegador con el cliente de Supabase— sin pasar nunca por `/api/perfil`. Con la barrera solo en la aplicación, almacenar un perfil con etiquetas clínicas era trivial.

Ahora **la base de datos aplica el mismo límite**: `es_perfil_detectado_valido()` normaliza la explicación (`translate` sobre `áéíóúüñ` en ambas cajas, después `lower`) y rechaza las mismas 19 raíces que TypeScript. No se usa `unaccent` ni ninguna extensión nueva. Una explicación con vocabulario clínico hace fallar la RPC **antes** del `INSERT`; nunca se recorta ni se reescribe para aceptarla.

La paridad entre ambas listas está cubierta por una prueba automatizada que compara la constante exportada de TypeScript contra el texto del SQL.

### Permisos de la RPC cerrados explícitamente

PostgreSQL concede `EXECUTE` a `PUBLIC` por defecto al crear una función, lo que en una `SECURITY DEFINER` es especialmente delicado. `0004` ahora revoca de `PUBLIC` y de `anon` en sentencias separadas con la firma completa, y concede `EXECUTE` únicamente a `authenticated`. La función de validación queda sin ejecución para ningún rol de la API: solo la usa la RPC, que corre con los privilegios de su propietario.

Se conserva sin cambios: identidad exclusivamente desde `auth.uid()`, ausencia de parámetro de usuario, `search_path = pg_catalog`, escritura atómica de respuestas y perfil, rechazo de diagnóstico duplicado, y ningún permiso directo sobre `perfil_detectado`.

### Rutas pendientes de consolidar: **13**

Tres modificadas (`docs/PROGRESO.md`, `src/components/auth/VistaProtegida.tsx`, `tsconfig.json`) y diez sin seguimiento. El informe de F1-A1 dijo "12": fue un error aritmético, no una ruta ausente — 10 creados + 3 modificados son 13.

### Evidencia local

- `node --test src/lib/auth/contrato.test.mjs`: **96/96**.
- `node --test src/lib/diagnostico/contrato.test.mjs`: **62/62** (46 previas + 16 nuevas).
- `npm run lint`, `npm run build`: exitosos, con `noEmit` y `allowImportingTsExtensions` activos.
- Migraciones `0001`, `0002` y `0003`: hashes SHA-256 sin cambio.

### Límite explícito de esta corrección

Las pruebas que verifican los permisos y la estructura de `0004` **leen el texto del archivo**: comprueban arquitectura SQL **todavía no ejecutada**. No demuestran el comportamiento real de la RPC ni de los `GRANT`/`REVOKE` en PostgreSQL. Esa comprobación corresponde a F1-A2, después de aplicar la migración.

---

## Día 3 — F1-A1R2: normalización canónica de la barrera clínica (7 de agosto de 2026)

**Estado: Día 3 sigue EN PROGRESO. `0004` continúa SIN APLICARSE. No hay llamada real a Gemini ni persistencia remota comprobada.**

Corrección local. Rama `feature/dia3-diagnostico-gemini`, sin commit ni push. **13 rutas pendientes**, sin cambio.

### Hallazgo corregido: la paridad TypeScript/SQL era aparente, no real

F1-A1R dio por equiparadas ambas capas, pero usaban algoritmos distintos. SQL sustituía vocales acentuadas **precompuestas** con `translate()`; TypeScript descomponía en NFD y eliminaba las marcas combinantes.

La diferencia importa: la cadena `"diagno" + U+0301 + "stico cli" + U+0301 + "nico"` **se ve idéntica** a "diagnóstico clínico", pero `translate()` no elimina esa marca combinante, así que la raíz no coincidía y PostgreSQL aceptaba el perfil. TypeScript sí lo detectaba. Como `authenticated` puede invocar la RPC directamente, era un atajo efectivo alrededor de la barrera SQL.

### Normalización canónica común

Ambas capas reducen ahora el texto a la misma forma antes de comparar: **NFD → minúsculas → solo `a-z0-9`**.

| | Implementación |
|---|---|
| TypeScript | `texto.normalize('NFD').toLowerCase().replace(/[^a-z0-9]/g, '')` |
| PostgreSQL | `regexp_replace(lower(normalize(texto, NFD)), '[^a-z0-9]', '', 'g')` |

La misma transformación se aplica **también a cada raíz**, de modo que las de varias palabras pierden sus espacios igual que el texto.

Además de las tildes descompuestas, esto cierra los separadores evasivos (`T.D.A.H.` → `tdah`, `diag-nóstico` → `diagnostico`) y los espacios irregulares (`déficit  de atención` → `deficitdeatencion`).

Sin extensiones: `normalize()` y `regexp_replace()` son nativas de PostgreSQL (`normalize` desde la versión 13). No se usa `unaccent`. La eliminación de tildes no depende de la configuración regional.

Se conservan intactos: las 19 raíces, los estilos y niveles permitidos, los `REVOKE`/`GRANT` aprobados, `SECURITY DEFINER`, `search_path` endurecido, identidad desde `auth.uid()`, ausencia de `usuario_id` y de `service_role`, persistencia atómica y rechazo de duplicados.

**La explicación que se persiste nunca se modifica**: la forma canónica existe solo dentro de la comparación. Verificado por prueba.

### Evidencia local

- `node --test src/lib/auth/contrato.test.mjs`: **96/96**.
- `node --test src/lib/diagnostico/contrato.test.mjs`: **73/73** (62 previas + 11 nuevas).
- `npm run lint`, `npm run build`: exitosos.
- Migraciones `0001`, `0002` y `0003`: hashes SHA-256 sin cambio. El de `0004` cambia, como corresponde a una propuesta local reparada.

### Requisito añadido para F1-A2

Confirmar que **`server_encoding` es `UTF8`** antes de aplicar `0004`: `normalize()` exige esa codificación.

---

## Sprint A — Gemini real y perfil persistente (10 de agosto de 2026)

**Estado: el recorrido positivo completo funciona de extremo a extremo.** `0004` está aplicada en remoto y verificada equivalente al archivo local. Hay una llamada real a Gemini, un perfil validado y persistido, y una vista que lo recupera.

### Causa del `502`: el modelo estaba retirado

Las dos llamadas anteriores devolvían `502 perfil_no_disponible` sin más pistas, porque `cliente.ts` descartaba a propósito el cuerpo del error del proveedor. Al instrumentarlo apareció la causa en el primer intento:

```
http=404 codigo=NOT_FOUND
mensaje="This model models/gemini-2.5-flash is no longer available to new users."
```

No era la clave, ni el `responseSchema`, ni la red, ni la facturación. `gemini-2.5-flash` **sigue apareciendo** en el catálogo de `/v1beta/models`, pero ya no acepta `generateContent` con claves creadas recientemente: el listado no es prueba de disponibilidad.

Se sustituyó por **`gemini-3.6-flash`**, elegido entre los 36 modelos con `generateContent` habilitados para esta clave. Se prefirió un nombre fijo antes que el alias `gemini-flash-latest` para que la versión no cambie sola entre la grabación del video y la revisión del jurado.

El `responseSchema` no necesitó ningún cambio: `maxLength`, `minimum` y `maximum` se aceptan tal cual.

### La decisión de no registrar nada era la que ocultaba el fallo

Descartar el error del proveedor protegía bien y diagnosticaba fatal: cuatro causas muy distintas colapsaban en el mismo `502`. Ahora `cliente.ts` escribe una traza **solo de servidor** con etapa, estado HTTP, categoría, código del proveedor y mensaje saneado y truncado a 200 caracteres.

La respuesta HTTP que ve el navegador **no cambió**: sigue siendo el mismo conjunto cerrado de códigos. Y la prueba que antes prohibía `console.*` en el archivo fue reemplazada por una que comprueba la propiedad real: se simula un proveedor que devuelve la clave completa dentro de su mensaje de error y se verifica que en la traza aparece `[REDACTADO]`, nunca la clave.

### Ejecución positiva

| | |
|---|---|
| `POST /api/perfil` | **200** en 4,3 s |
| Diagnósticos creados | **1** (exactamente) |
| Respuestas persistidas | **12** (`p1`…`p12`) |
| Claves del perfil | **3** (`estilo_aprendizaje`, `nivel_sugerido`, `explicacion`) |
| Registros parciales o duplicados | ninguno |

### Perfil persistente

Ruta nueva `/perfil`: relee `diagnosticos.perfil_detectado` por RLS y **vuelve a validarlo con el mismo contrato** antes de mostrarlo. La fila puede haberse escrito por otra vía —`authenticated` conserva `INSERT` directo sobre `(usuario_id, respuestas)`—, así que confiar en la base de datos como si fuera código propio sería un error.

Se distinguen cuatro estados, y la distinción importa: `sin_diagnostico` redirige al test, pero un `error` de red **no** lo hace. Confundirlos empujaría al usuario hacia un segundo envío que la restricción `UNIQUE` rechazaría. Un `perfil_incompleto` (fila sin perfil válido) tampoco redirige: mandar al test a quien ya ocupa su única fila es un bucle sin salida, porque no hay policy de `DELETE`.

El `409` por diagnóstico existente ya no muestra "puedes intentarlo de nuevo": lleva a `/perfil`. El formulario, además, comprueba antes de dibujarse si ya hay diagnóstico, de modo que ese `409` no debería llegar a ocurrir.

La tarjeta del perfil se extrajo a un componente compartido y el bloque en línea del formulario se eliminó: tras generar se redirige a `/perfil`, así que lo que se ve al terminar el test es exactamente lo mismo que se verá al volver mañana, sin una copia en memoria que pueda divergir.

Verificado en vivo: recarga dura, y cierre de sesión con nuevo inicio de sesión manual. El perfil sobrevive a ambos.

### Evidencia

- Suite completa: **282/282**.
- `npm run lint` y `npm run build`: exitosos. `/perfil` aparece en el manifiesto de rutas.
- Título y descripción del layout corregidos (decían "Create Next App"), e idioma del documento pasado a `es`.

### Pendiente

Actividad adaptativa, registro de intentos y despliegue. Las pruebas negativas de la RPC siguen aplazadas hasta después de la entrega.

---

## Sprint B — Actividad adaptativa mínima e intento persistido (10 de agosto de 2026)

Ruta nueva `/actividad`, protegida por sesión y por perfil: sin perfil redirige a `/diagnostico`, porque sin nivel de partida la parte adaptativa sería inventada.

### Qué decide cada capa

El reparto es deliberado y conviene no difuminarlo en la narrativa del jurado:

| Decisión | Quién la toma |
|---|---|
| Estilo y nivel inicial | **Gemini**, en el perfil del diagnóstico |
| Qué ejercicio se presenta | Selección determinista sobre ese nivel |
| Si la respuesta es correcta | **PostgreSQL**, dentro de `registrar_intento()` |
| Qué nivel se recomienda después | Regla determinista sobre nivel y resultado |

La interfaz dice exactamente eso. **No se afirma que Gemini haya creado el ejercicio**: generó el perfil que orienta la selección.

### Selección

Se elige el ejercicio del nivel más cercano al sugerido. Ante empate de distancia se prefiere el **nivel más bajo**: empezar por lo más fácil permite avanzar, mientras que empezar por lo más difícil puede frenar en seco a quien acaba de llegar. Segundo desempate por `id`, para que una demo sea reproducible.

Con el banco actual (un ejercicio de nivel 1) y un perfil de nivel 1, la coincidencia es exacta.

### La respuesta correcta no puede llegar al navegador

Comprobado contra el proyecto remoto: `GET /rest/v1/ejercicios_respuestas` con la sesión de un usuario autenticado devuelve **403**. La tabla tiene RLS activo sin ninguna policy, así que la garantía es del esquema, no del cuidado del cliente.

Sobre eso se añade una barrera redundante: `validarEjercicio()` descarta cualquier ejercicio cuyo `contenido` público incluya una clave como `respuesta_correcta` o `solucion`. Si alguien sembrara un ejercicio mal formado, se descarta en vez de filtrarlo.

### El veredicto no se calcula en el cliente

A la RPC solo viajan `p_ejercicio_id`, `p_respuesta_dada` y `p_tiempo_respuesta`. No se envía `correcto` ni `usuario_id`: lo primero lo decide la base comparando contra `ejercicios_respuestas`, lo segundo sale de `auth.uid()` dentro de la función. Hay una prueba estática que falla si alguna de esas claves aparece en la llamada.

Doble envío bloqueado por guardia de estado (`if (estado !== 'respondiendo') return`) y por el botón deshabilitado mientras la petición está en vuelo.

### Progreso sin columnas nuevas

La recomendación se reconstruye cruzando `intentos.ejercicio_id` con el banco: el nivel realizado sale de ahí, no de un valor derivado y guardado. Por eso sobrevive a una recarga **sin migración alguna**.

Regla: acierto sube un nivel, fallo baja uno, acotado a 1–5; en un límite se indica explícitamente que el nivel se mantiene. Si el intento apunta a un ejercicio que ya no está en el banco, no se inventa un nivel: se cae al del perfil.

Al recargar con un intento ya registrado se muestra el resultado, nunca el formulario — así una recarga no puede crear un segundo intento.

### Evidencia

- `src/lib/actividad/contrato.test.mjs`: **28/28**.
- Suite completa: **310/310**.
- `npm run lint` y `npm run build`: exitosos. `/actividad` en el manifiesto de rutas.
- Sin migraciones, sin SQL manual, sin ampliar el banco de ejercicios.
