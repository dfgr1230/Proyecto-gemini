# Plan de aplicación y smoke test remoto — Día 3 (ciclo adaptativo)

**Estado: PREPARADO, NO EJECUTADO.** Nada de este documento se ha ejecutado contra Supabase. No se ha corrido `db push`, `db reset`, `migration repair` ni ninguna sentencia SQL remota.

Entorno confirmado: PostgreSQL **17.6**, proyecto `guajevcvmehehdqrtmmm`, **Supabase CLI v2.98.1** (disponible a través de la caché de `npx`, no en el `PATH`), proyecto enlazado. Docker no está disponible, así que `db reset` y el entorno local quedan descartados de todos modos — pero no hacen falta.

---

## 0. Estado real del historial de migraciones

**Comprobado**, no inferido. Ejecutado `supabase migration list --linked` (solo lectura):

```
   Local | Remote | Time (UTC)
  -------|--------|------------
   0001  | 0001   | 0001
   0002  | 0002   | 0002
   0003  | 0003   | 0003
   0004  | 0004   | 0004
```

Las cuatro migraciones están **registradas en el historial remoto** y coinciden con las locales. No hay desfase, no hay huérfanas y no hace falta ninguna reparación.

Esto corrige dos afirmaciones anteriores mías:

| Afirmación anterior | Realidad |
|---|---|
| «No hay Supabase CLI instalada» | **Falso.** Está en v2.98.1 y el proyecto está enlazado. Mi comprobación buscó `supabase` en el `PATH` y me quedé ahí. |
| «Probablemente `supabase_migrations.schema_migrations` esté vacía» | **Falso.** Contiene `0001`–`0004`. |

La distinción metodológica sigue siendo válida —la existencia de objetos no demuestra el registro en el historial— pero en este proyecto ambas cosas se cumplen, y ahora con evidencia directa de cada una.

**Consecuencia práctica:** `0005` y `0006` se incorporan a un historial sano y continuo. No hay ninguna decisión pendiente sobre `0001`–`0004`.

---

## 1. Orden de aplicación

Cada archivo se aplica **completo**. No se copian secciones sueltas.

| Paso | Archivo | Contenido |
|---|---|---|
| 1 | `docs/borrador-0005-dia3-analisis-adaptativos.sql` | estructura: 2 funciones de validación, tabla, índice, RLS, permisos, RPC |
| 2 | `docs/borrador-0006-dia3-ampliar-banco.sql` | contenido: 4 ejercicios y sus respuestas oficiales |

Son independientes entre sí y pueden aplicarse en cualquier orden, pero **cada uno entero**. Antes de ejecutar, el archivo se mueve a `supabase/migrations/` con su nombre definitivo (`0005_dia3_analisis_adaptativos.sql`, `0006_dia3_ampliar_banco.sql`) para que el historial del repositorio quede completo aunque el registro en la base de datos venga después.

### Qué pasa si el SQL falla a medias

Cada archivo abre `begin;` y cierra `commit;`, y PostgreSQL aplica DDL de forma transaccional. **Un error en cualquier sentencia revierte el archivo completo**: no quedan ni la tabla sin su RPC, ni ejercicios sin su respuesta oficial. El SQL Editor mostrará el error y la base de datos quedará exactamente como estaba.

Las dos condiciones que rompen esa garantía, y que hay que evitar activamente:

- **pegar solo una parte del archivo** — se perdería el `commit;` o el `begin;` y el alcance de la transacción dejaría de ser el previsto;
- **ejecutar el archivo por trozos en varias pasadas** — cada trozo sería su propia transacción.

En ambos casos sí es posible un estado intermedio. Por eso la regla es una sola pasada con el archivo íntegro.

---

## 2. Verificación del esquema (solo lectura, antes de registrar nada)

Ejecutar en el SQL Editor **después** de aplicar y **antes** de tocar el historial. Todas son consultas de lectura.

### 2.1 Después de 0005

```sql
select
  (select count(*) from information_schema.tables
     where table_schema = 'public' and table_name = 'analisis_adaptativos')            as tabla,
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'analisis_adaptativos')            as columnas,
  (select count(*) from pg_constraint
     where conname = 'analisis_adaptativos_intento_unico')                             as unico_intento,
  (select relrowsecurity from pg_class
     where oid = 'public.analisis_adaptativos'::regclass)                              as rls_activo,
  (select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'analisis_adaptativos')               as policies,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('guardar_analisis_adaptativo',
                         'es_analisis_adaptativo_valido',
                         'es_metadatos_analisis_valido'))                              as funciones;
```

Esperado: `tabla=1`, `columnas=7`, `unico_intento=1`, `rls_activo=true`, `policies=1`, `funciones=3`.

```sql
select
  has_table_privilege('authenticated', 'public.analisis_adaptativos', 'select')   as auth_lee,
  has_table_privilege('authenticated', 'public.analisis_adaptativos', 'insert')   as auth_inserta,
  has_table_privilege('authenticated', 'public.analisis_adaptativos', 'update')   as auth_actualiza,
  has_table_privilege('authenticated', 'public.analisis_adaptativos', 'delete')   as auth_borra,
  has_table_privilege('anon',          'public.analisis_adaptativos', 'select')   as anon_lee,
  has_table_privilege('service_role',  'public.analisis_adaptativos', 'insert')   as sr_inserta,
  has_function_privilege('authenticated',
    'public.guardar_analisis_adaptativo(uuid,jsonb,jsonb)', 'execute')            as rpc_auth,
  has_function_privilege('anon',
    'public.guardar_analisis_adaptativo(uuid,jsonb,jsonb)', 'execute')            as rpc_anon,
  has_function_privilege('service_role',
    'public.guardar_analisis_adaptativo(uuid,jsonb,jsonb)', 'execute')            as rpc_sr,
  has_function_privilege('authenticated',
    'public.es_analisis_adaptativo_valido(jsonb)', 'execute')                     as validacion_auth;
```

Esperado: **`auth_lee=true` y `rpc_sr=true`; todo lo demás `false`.**

En particular `rpc_auth` y `rpc_anon` deben ser **`false`**: es la corrección de procedencia, y si alguno saliera `true` la migración no quedó como se diseñó. `sr_inserta=false` confirma que ni siquiera la credencial de servidor puede escribir la tabla saltándose la RPC.

```sql
-- La secuencia implícita de la columna IDENTITY tampoco debe quedar abierta.
select
  has_sequence_privilege('authenticated', 'public.analisis_adaptativos_version_seq', 'usage')  as auth_usa,
  has_sequence_privilege('anon',          'public.analisis_adaptativos_version_seq', 'usage')  as anon_usa,
  has_sequence_privilege('service_role',  'public.analisis_adaptativos_version_seq', 'usage')  as sr_usa;
```

Esperado: las tres `false`.

```sql
-- La columna de metadatos debe ser obligatoria.
select is_nullable from information_schema.columns
 where table_schema = 'public' and table_name = 'analisis_adaptativos'
   and column_name = 'metadatos';
```

Esperado: `NO`.

```sql
-- La única policy debe ser de SELECT y sobre el propio usuario.
select polname, polcmd, pg_get_expr(polqual, polrelid) as usando
  from pg_policy where polrelid = 'public.analisis_adaptativos'::regclass;
```

Esperado: una fila, `polcmd = 'r'` (SELECT), `usando` conteniendo `auth.uid() = usuario_id`.

### 2.2 Después de 0006

```sql
select
  (select count(*) from public.ejercicios)                                   as ejercicios,
  (select count(*) from public.ejercicios where materia = 'lenguaje')        as lenguaje,
  (select count(*) from public.ejercicios_respuestas)                        as respuestas,
  (select count(distinct respuesta_correcta) from public.ejercicios_respuestas) as opciones_distintas,
  (select count(*) from public.ejercicios
     where contenido ?| array['respuesta_correcta','respuesta','correcta','solucion']) as fugas;
```

Esperado: `ejercicios=5`, `lenguaje=2`, `respuestas=5`, `opciones_distintas>1`, **`fugas=0`**.

---

## 3. Registro en el historial de migraciones

**No ejecutar `migration repair` sin resolver antes el punto 0.**

### Qué versión exacta habría que registrar

El CLI de Supabase deriva la versión del prefijo numérico del nombre de archivo. Con los nombres propuestos, las versiones son literalmente **`0005`** y **`0006`**.

> Aviso: el CLI moderno espera versiones con formato de marca de tiempo (`YYYYMMDDHHMMSS`). Este repositorio usa la numeración corta `0001`–`0004` desde el Día 2. **No hay que renumerar nada ahora**: `0005` y `0006` son la continuación coherente de lo que ya existe. Cambiar el esquema de numeración a mitad de proyecto crearía una discrepancia peor que la que resolvería.

### En qué momento

Solo después de que **todas** las verificaciones del paso 2 devuelvan los valores esperados. Nunca antes, y nunca "por si acaso".

### Qué comprobar primero

1. Ejecutar de nuevo `supabase migration list --linked` (solo lectura). Debe seguir mostrando `0001`–`0004` alineadas.
2. Aplicar el SQL y ejecutar **todas** las consultas de verificación del paso 2.
3. Volver a ejecutar `supabase migration list --linked`. Aparecerán `0005`/`0006` en **Local** y vacías en **Remote**: eso es exactamente lo esperado tras aplicar por SQL Editor, porque el Editor no toca `supabase_migrations.schema_migrations`.
4. Solo entonces registrar, y solo si el paso 2 fue limpio.

El historial de partida está sano (`0001`–`0004` alineadas), así que no hay ninguna decisión previa pendiente.

### Cómo evitar registrar algo que no quedó aplicado

La regla es simple y no admite atajos: **el registro sigue a la verificación, nunca la precede**. En concreto:

- si cualquier consulta del paso 2 devuelve un valor distinto del esperado, **no se registra nada** y se investiga primero;
- si el SQL falló, la transacción revirtió y no hay nada que registrar — el estado correcto del historial es "no aplicada";
- no se registra basándose en que "el SQL Editor no mostró error": el criterio es el resultado de las consultas de verificación, no la ausencia de un mensaje rojo.

Un historial que afirma que una migración está aplicada cuando no lo está es peor que un historial vacío: convierte un problema visible en uno silencioso.

---

## 4. Smoke test remoto autenticado

**Requisitos previos:** `0005` y `0006` aplicadas y verificadas; **`SUPABASE_SECRET_KEY` configurada** (ver §6); una cuenta de prueba real con diagnóstico y perfil ya generados; una **segunda** cuenta de prueba para el punto 9.

Si la variable no está configurada, los pasos 1-3 y 5-7 funcionan igual y los pasos 4, 8 y 10 mostrarán `conservacion = 'credencial_ausente'`: el ciclo opera y lo declara, sin fingir que conservó nada.

Todas las escrituras las produce la aplicación real (`/ciclo`), no SQL manual: el objetivo es demostrar el camino real de extremo a extremo, no fabricar filas.

### 4.0 Conteos ANTES (SQL Editor, solo lectura)

```sql
select
  (select count(*) from public.intentos)              as intentos,
  (select count(*) from public.analisis_adaptativos)  as analisis,
  (select count(*) from public.ejercicios)            as ejercicios;
```

Anotar los tres números. No se registran correos, UUID ni ningún dato personal.

### 4.1 → 4.10 Pasos

| # | Acción | Evidencia esperada |
|---|---|---|
| 1 | Iniciar sesión con la cuenta A, abrir `/ciclo`, responder la primera actividad | La interfaz muestra «Interacción 1» con veredicto |
| 2 | Comprobar la fila del intento | `intentos` sube exactamente **+1**; `correcto` coincide con lo mostrado |
| 3 | Comprobar la llamada real a Gemini | El panel muestra «Generado por `gemini-3.6-flash` en N ms»; el log del servidor contiene una línea `[ciclo] iteracion=1 modelo=… ms=… fin=STOP` |
| 4 | Comprobar la fila del análisis | `analisis_adaptativos` sube exactamente **+1**, con `version=1` para ese usuario e `intento_id` igual al intento del paso 2 |
| 5 | Comprobar la siguiente actividad | Es un ejercicio **distinto** del ya respondido y coherente con `nivel_recomendado` / `siguiente_actividad_materia` del análisis |
| 6 | Pulsar «Continuar» y responder la segunda actividad | La interfaz muestra «Interacción 2» |
| 7 | Comprobar el encadenamiento | El panel muestra «Este análisis partió del anterior (nivel recomendado X…)»; la `justificacion` del segundo análisis menciona el primero; `analisis_previo` no es nulo |
| 8 | Reintento idempotente: recargar y reenviar la **misma** respuesta al **mismo** ejercicio | `intentos` y `analisis_adaptativos` **no cambian**; la respuesta marca `reutilizado = true` |
| 9 | Aislamiento: iniciar sesión con la cuenta B y abrir `/ciclo` | B no ve ningún análisis de A. Comprobación explícita desde la consola del navegador con la sesión de B: `supabase.from('analisis_adaptativos').select('*')` devuelve **solo filas de B** (cero si no tiene). Un `insert` directo sobre esa tabla debe fallar con `42501` |
| 10 | Conteos DESPUÉS | `intentos` = antes **+2**; `analisis_adaptativos` = antes **+2**; `ejercicios` sin cambio |

### 4.11 Comprobaciones negativas adicionales (con la sesión de A, desde la consola)

| Prueba | Resultado esperado |
|---|---|
| **`rpc('guardar_analisis_adaptativo', {...})` desde el navegador con la sesión de A** | **`42501 permission denied` / `PGRST202`.** Es la prueba central de procedencia: el usuario no puede escribir un análisis por ninguna vía |
| `from('analisis_adaptativos').insert({...})` con la sesión de A | `42501` (sin privilegio) — y además no hay policy de INSERT |
| `from('analisis_adaptativos').update(...)` / `.delete(...)` con la sesión de A | `42501` |
| `from('ejercicios_respuestas').select('*')` | `42501` / 403 |

Y desde el servidor (script puntual con la credencial, **no** desde el navegador):

| Prueba | Resultado esperado |
|---|---|
| RPC con el `intento_id` de B y análisis válido | crea la fila **con `usuario_id` de B**, nunca de A: el propietario sale de la fila del intento. Confirma que la credencial no permite falsificar la identidad, solo actuar |
| RPC con un `intento_id` inexistente | error: «El intento no existe» |
| RPC repetida sobre un intento ya analizado, con contenido distinto | devuelve el análisis **existente** sin sobrescribir; `analisis_adaptativos` no crece |
| RPC con un análisis de 8 claves | error: «Analisis adaptativo invalido» |
| RPC con `justificacion` conteniendo «trastorno» | error: «Analisis adaptativo invalido» |
| RPC con `p_metadatos: null` o `{ basura: 1 }` | error: «Metadatos de analisis invalidos» |

### 4.12 Qué NO se registra en el informe del smoke test

Correos, contraseñas, UUID de usuario, tokens, `access_token`, y el contenido íntegro de `respuestas` del diagnóstico. Solo conteos, códigos de error, versiones, niveles y duraciones.

---

## 6. La credencial de servidor (todavía no creada)

**No se ha introducido ninguna credencial real.** `.env.local` sigue conteniendo exactamente las tres variables de siempre. Lo que sigue es lo que haría falta.

### Variable necesaria

```
SUPABASE_SECRET_KEY=
```

Ya está declarada, **vacía**, en `.env.example`, con la explicación de su alcance.

### Cómo se impide que llegue al cliente

Cinco barreras, de la más fuerte a la más débil:

1. **Sin prefijo `NEXT_PUBLIC_`.** Next.js solo sustituye en el bundle del navegador las variables con ese prefijo. Sin él, `process.env.SUPABASE_SECRET_KEY` es `undefined` en cliente — no queda un hueco, queda nada.
2. **Un solo archivo la lee**: `src/lib/supabase/servidorPrivilegiado.ts`, verificado por una prueba que recorre todo `src/` y falla si aparece en cualquier otro sitio.
3. **Guardia de navegador**: ese módulo lanza si `typeof window !== 'undefined'`, de modo que un import accidental desde cliente falla ruidosamente en vez de filtrar.
4. **Solo se usa en una ruta de API** (`/api/adaptar`), que es código de servidor por construcción en el App Router.
5. **Nunca se registra su valor ni su longitud**: si falta, el log dice solo que falta.

### Cómo verificar su ausencia en `.next/static`

Tras `npm run build`, recorrer los archivos generados buscando el nombre de la variable, su valor, el nombre del módulo privilegiado y el de la RPC:

```powershell
$secreto = ((Get-Content ".env.local" | Where-Object { $_ -match '^SUPABASE_SECRET_KEY=' }) -replace '^SUPABASE_SECRET_KEY=','').Trim()
Get-ChildItem -Recurse -File ".next/static" | ForEach-Object {
  $c = [System.IO.File]::ReadAllText($_.FullName)
  foreach ($p in @('SUPABASE_SECRET_KEY','servidorPrivilegiado','guardar_analisis_adaptativo')) {
    if ($c.Contains($p)) { "COINCIDENCIA '$p' EN: $($_.Name)" }
  }
  if ($secreto -and $c.Contains($secreto)) { "VALOR SECRETO EN: $($_.Name)" }
}
```

Ejecutado hoy sobre los **33** archivos de `.next/static`, con la variable aún vacía: **cero coincidencias** para los tres nombres, y cero también para `GEMINI_API_KEY`, su valor real, el endpoint de Gemini y el texto del prompt. La comprobación debe repetirse **después** de configurar la variable, porque solo entonces el valor existe y puede buscarse.

### Alternativa más estricta, para más adelante

`SUPABASE_SECRET_KEY` corresponde a `service_role`, que en general ignora RLS. Aquí se estrecha por dos vías —se usa para **una** llamada y nada más, y `0005` le retira la escritura directa sobre la tabla— pero sigue siendo una clave amplia si se filtrase.

La versión realmente mínima sería un rol de PostgreSQL dedicado (`escritor_analisis`) con `EXECUTE` sobre esa única función y nada más, alcanzado con un JWT firmado con el secreto JWT del proyecto. Queda anotado como mejora, no como requisito de hoy: depende de que el proyecto exponga un secreto JWT simétrico, algo que no se ha comprobado y que no se va a comprobar sin autorización.

---

## 5. Reversión

Si algo sale mal después de aplicar `0005`, la reversión es una decisión separada y explícita —no forma parte de este plan— y afectaría a datos reales de estudiantes. Lo único seguro y reversible sin pérdida es **no aplicar**: mientras `0005` no esté aplicada, la aplicación funciona con `conservacion = 'almacen_no_disponible'` y lo declara en la interfaz.
