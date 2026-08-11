-- ================================================================
-- Dia 3 -- Almacen del ciclo adaptativo
-- Archivo: supabase/migrations/0005_dia3_analisis_adaptativos.sql
--
-- Procede del borrador auditado docs/borrador-0005-dia3-analisis-adaptativos.sql.
-- Al promoverlo a migracion solo cambio ESTE bloque de cabecera: ninguna
-- sentencia SQL se modifico. La huella SHA-256 del cuerpo ejecutable
-- (todas las lineas que no son comentario ni linea vacia) es la misma
-- antes y despues del traslado:
--   841AE0750E0A860443ED195E063E6217DAACC62808207B341BD531EBCBDCA89B
--
-- ESTE ARCHIVO SE APLICA ENTERO O NO SE APLICA.
-- No se debe ejecutar una seleccion de secciones: la tabla depende de las
-- dos funciones de validacion (las usa en sus CHECK) y la RPC depende de
-- la tabla y de su restriccion unica. Todo va dentro de una unica
-- transaccion explicita; cualquier error revierte el archivo completo y
-- la base de datos queda exactamente como estaba.
--
-- La ampliacion del banco de ejercicios NO forma parte de este archivo:
-- vive en 0006_dia3_ampliar_banco.sql, que es una migracion
-- independiente. Mezclarlas obligaba a aplicar contenido pedagogico para
-- poder aplicar un cambio estructural, o al reves.
--
-- Objetivo del PostgreSQL destino: 17.6 (leido de supabase/.temp/
-- postgres-version). normalize(), gen_random_uuid() e IDENTITY son
-- nativas desde versiones muy anteriores; no se requiere ninguna
-- extension nueva.
--
-- ----------------------------------------------------------------
-- POR QUE HACE FALTA (comprobado, no supuesto):
--   Con el esquema vigente el analisis adaptativo NO se puede persistir:
--     - public.diagnosticos.usuario_id es UNIQUE, no hay policy de UPDATE
--       ni de DELETE, y guardar_diagnostico_con_perfil() rechaza
--       expresamente un segundo diagnostico. Esa fila es de un solo uso;
--     - public.usuarios solo concede "update (nombre)";
--     - public.intentos solo se escribe via registrar_intento(), que no
--       admite ningun campo libre.
--   No es una limitacion de la aplicacion: no existe el sitio.
--
-- POR QUE UNA TABLA Y NO REUSAR perfil_detectado:
--   El ciclo debe conservar una NUEVA VERSION del perfil en cada
--   iteracion, ligada a la evidencia que la origino. Una columna 1:1 con
--   el usuario no puede guardar un historial, y sobrescribirla destruiria
--   justamente lo que hay que demostrar.
--
-- POR QUE UNA RPC Y NO UNA POLICY DE INSERT:
--   Mismo criterio que 0004 y registrar_intento(): si el navegador
--   pudiera insertar, podria almacenar cualquier JSON como si fuera una
--   decision de Gemini. La RPC SECURITY DEFINER concentra la escritura y
--   valida DENTRO de la base de datos.
--
-- LO QUE ESTE ARCHIVO NO HACE (por diseno):
--   - No modifica, duplica ni reemplaza 0001, 0002, 0003 ni 0004.
--   - No altera ninguna tabla, columna, CHECK, policy ni GRANT existente.
--   - No desactiva ni debilita RLS en ninguna tabla.
--   - No concede UPDATE ni DELETE sobre ninguna tabla a ningun rol.
--   - No introduce service_role ni ningun permiso administrativo.
--   - No toca es_respuestas_diagnostico_valido() ni
--     es_perfil_detectado_valido().
--
-- PROCEDENCIA DE LA ESCRITURA (corregido tras la auditoria):
--   La version anterior de este borrador concedia EXECUTE de la RPC a
--   "authenticated". Eso dejaba abierto que cualquier usuario la invocara
--   desde la consola del navegador y colgara de su propio intento un JSON
--   con la forma correcta que Gemini nunca produjo. La validacion no
--   podia cerrarlo: un JSON inventado con la forma correcta la supera.
--
--   Ahora la RPC NO esta concedida a anon ni a authenticated. Solo la
--   ejecuta el servidor, con una credencial que el navegador no tiene
--   (variable exclusivamente de servidor SUPABASE_SECRET_KEY, sin el
--   prefijo NEXT_PUBLIC_; ver src/lib/supabase/servidorPrivilegiado.ts).
--   El unico camino hacia esta tabla es /api/adaptar, despues de haber
--   verificado la sesion contra el servidor de Auth y despues de que
--   Gemini haya devuelto una respuesta real y validada.
--
--   Ese cambio NO relaja la identidad. Bajo esa credencial auth.uid() es
--   nulo, asi que usuario_id ya no puede salir de ahi; sale de la FILA
--   DEL INTENTO, que fue creada por registrar_intento() ejecutandose con
--   el token del propio estudiante. Sigue siendo imposible sustituir
--   usuario_id desde un parametro o desde el JSON.
--
--   Y para que la credencial de servidor no se convierta en un permiso
--   mas amplio de lo necesario, tambien se le retira a service_role la
--   escritura DIRECTA sobre esta tabla: ni siquiera con esa clave se
--   pueden insertar filas saltandose la validacion de la RPC.
--
-- RIESGO RESIDUAL QUE ESTA MIGRACION NO PUEDE CERRAR (declarado a
-- proposito): quien tenga la credencial de servidor puede llamar a la RPC
-- con cualquier intento existente. Eso no es un fallo de esta migracion:
-- la credencial ES la frontera de confianza, y quien la posee ya
-- administra el sistema. Lo que la base de datos garantiza es la FORMA
-- (nueve claves exactas, rangos y vocabulario acotados), la EVIDENCIA
-- (metadatos obligatorios de una llamada real), la COHERENCIA (el
-- propietario sale de la fila del intento) y la INMUTABILIDAD (nada se
-- sobrescribe jamas).
-- ================================================================

begin;

-- ----------------------------------------------------------------
-- 1. VALIDACION DEL ANALISIS
--
-- Espeja validarAnalisisAdaptativo() de src/lib/adaptativo/contrato.ts.
-- La duplicacion es deliberada: la RPC queda expuesta a "authenticated",
-- de modo que un usuario puede invocarla directamente desde la consola
-- del navegador sin pasar por /api/adaptar. Si la unica barrera viviera
-- en TypeScript, almacenar un "analisis" con etiquetas clinicas o con
-- campos inventados seria trivial (es el mismo hallazgo que corrigio
-- F1-A1R sobre 0004).
--
-- CADA TEXTO SE COMPRUEBA POR SEPARADO, no concatenados.
-- Concatenarlos parecia mas simple pero introducia falsos positivos: la
-- normalizacion canonica elimina los espacios, asi que una fortaleza que
-- terminara en "...tras" seguida de una habilidad que empezara por
-- "torno" produciria "trastorno" al unirlas y el analisis se rechazaria
-- sin que ninguno de los dos textos contenga la raiz. TypeScript
-- comprueba campo por campo; aqui se hace igual, para que las dos capas
-- acepten y rechacen exactamente lo mismo.
--
-- Normalizacion canonica identica a TypeScript y a 0004:
--   NFD -> minusculas -> solo a-z0-9.
-- Requiere server_encoding = UTF8 (confirmado al aplicar 0004).
-- ----------------------------------------------------------------
create or replace function public.es_analisis_adaptativo_valido(p_analisis jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_texto text;
  v_elemento jsonb;
  v_nivel jsonb;
  v_clave text;
  v_raiz text;
  v_textos text[] := array[]::text[];
  -- Paridad exacta con RAICES_CLINICAS_PROHIBIDAS de
  -- src/lib/diagnostico/contrato.ts y con la lista de 0004.
  v_raices_prohibidas text[] := array[
    'asperger', 'autis', 'tdah', 'deficit de atencion', 'dislexi',
    'discapacidad', 'trastorno', 'sindrome', 'patolog',
    'diagnostico clinico', 'terapia', 'terapeut', 'tratamiento',
    'medicac', 'psicolog', 'psiquiatr', 'clinic',
    'coeficiente intelectual', 'retraso'
  ];
  -- Claves de texto simple y su longitud maxima, en el mismo orden y con
  -- los mismos limites que LONGITUD_MAXIMA_* del contrato de TypeScript.
  v_claves_texto text[] := array[
    'habilidad_prioritaria', 'apoyo_pedagogico',
    'siguiente_actividad_enfoque', 'justificacion'
  ];
  v_limites int[] := array[120, 240, 240, 400];
  v_i int;
begin
  if p_analisis is null or jsonb_typeof(p_analisis) <> 'object' then
    return false;
  end if;

  -- Exactamente nueve claves, y exactamente las esperadas. Rechazar las
  -- propiedades de mas (en vez de ignorarlas) es lo que impide que el
  -- modelo introduzca campos que este producto no debe almacenar.
  if (select count(*) from jsonb_object_keys(p_analisis)) <> 9 then
    return false;
  end if;

  if not (p_analisis ? 'fortalezas'
          and p_analisis ? 'dificultades'
          and p_analisis ? 'habilidad_prioritaria'
          and p_analisis ? 'nivel_recomendado'
          and p_analisis ? 'apoyo_pedagogico'
          and p_analisis ? 'siguiente_actividad_materia'
          and p_analisis ? 'siguiente_actividad_enfoque'
          and p_analisis ? 'justificacion'
          and p_analisis ? 'confianza') then
    return false;
  end if;

  -- Listas: array de 1 a 3 cadenas no vacias, cada una de 120 caracteres
  -- como maximo (MAXIMO_ELEMENTOS_LISTA y LONGITUD_MAXIMA_ELEMENTO).
  foreach v_clave in array array['fortalezas', 'dificultades'] loop
    if jsonb_typeof(p_analisis -> v_clave) <> 'array' then
      return false;
    end if;
    if jsonb_array_length(p_analisis -> v_clave) < 1
       or jsonb_array_length(p_analisis -> v_clave) > 3 then
      return false;
    end if;
    for v_elemento in select value from jsonb_array_elements(p_analisis -> v_clave) loop
      if jsonb_typeof(v_elemento) <> 'string' then
        return false;
      end if;
      v_texto := v_elemento #>> '{}';
      if length(trim(v_texto)) = 0 or length(v_texto) > 120 then
        return false;
      end if;
      v_textos := v_textos || v_texto;
    end loop;
  end loop;

  -- Textos simples.
  for v_i in 1 .. array_length(v_claves_texto, 1) loop
    if jsonb_typeof(p_analisis -> v_claves_texto[v_i]) <> 'string' then
      return false;
    end if;
    v_texto := p_analisis ->> v_claves_texto[v_i];
    if length(trim(v_texto)) = 0 or length(v_texto) > v_limites[v_i] then
      return false;
    end if;
    v_textos := v_textos || v_texto;
  end loop;

  -- nivel_recomendado: entero 1..5, la misma escala del CHECK de
  -- public.ejercicios.nivel_dificultad en 0001. Se comprueba que sea
  -- numerico ANTES de convertirlo, y que no tenga parte decimal.
  v_nivel := p_analisis -> 'nivel_recomendado';
  if jsonb_typeof(v_nivel) <> 'number' then
    return false;
  end if;
  if (v_nivel #>> '{}')::numeric <> trunc((v_nivel #>> '{}')::numeric) then
    return false;
  end if;
  if (v_nivel #>> '{}')::numeric < 1 or (v_nivel #>> '{}')::numeric > 5 then
    return false;
  end if;

  -- Vocabularios cerrados. La materia coincide a proposito con el CHECK
  -- de public.ejercicios.materia en 0001, para que la recomendacion sea
  -- directamente utilizable al buscar la siguiente actividad.
  if jsonb_typeof(p_analisis -> 'siguiente_actividad_materia') <> 'string'
     or (p_analisis ->> 'siguiente_actividad_materia') not in ('matematicas', 'lenguaje') then
    return false;
  end if;

  if jsonb_typeof(p_analisis -> 'confianza') <> 'string'
     or (p_analisis ->> 'confianza') not in ('baja', 'media', 'alta') then
    return false;
  end if;

  -- Barrera clinica, texto por texto. Ante cualquier coincidencia se
  -- rechaza el analisis COMPLETO: no se recorta, no se reescribe y no se
  -- "limpia" para poder aceptarlo. El valor que se persiste es siempre el
  -- original; la forma canonica existe solo dentro de la comparacion.
  foreach v_texto in array v_textos loop
    foreach v_raiz in array v_raices_prohibidas loop
      if position(
           regexp_replace(lower(normalize(v_raiz, NFD)), '[^a-z0-9]', '', 'g')
           in regexp_replace(lower(normalize(v_texto, NFD)), '[^a-z0-9]', '', 'g')
         ) > 0 then
        return false;
      end if;
    end loop;
  end loop;

  return true;
end;
$$;

-- ----------------------------------------------------------------
-- 2. VALIDACION DE LOS METADATOS
--
-- Los metadatos existen para poder DEMOSTRAR que hubo una llamada real a
-- Gemini. Pero p_metadatos es un parametro que el llamante controla, y
-- "authenticated" puede invocar la RPC directamente: sin esta funcion, la
-- columna seria un deposito de JSON arbitrario de tamano libre colgado de
-- la base de datos.
--
-- NO se admite NULL. Los metadatos son la unica evidencia estructurada de
-- que hubo una llamada real al proveedor; permitir conservar un analisis
-- sin ellos abriria la via de guardar una decision "de Gemini" sin
-- siquiera afirmar que se llamo a Gemini. La columna es NOT NULL y la
-- aplicacion no persiste cuando faltan (ver ejecutarCicloAdaptativo).
--
-- Se exige un objeto con EXACTAMENTE las cuatro claves que produce
-- construirParametrosAnalisis() en src/lib/adaptativo/persistencia.ts.
--
-- Los limites superiores son holgados a proposito: no pretenden ser
-- medidas, solo impedir que se use la columna como almacen.
-- ----------------------------------------------------------------
create or replace function public.es_metadatos_analisis_valido(p_metadatos jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_valor jsonb;
begin
  if p_metadatos is null or jsonb_typeof(p_metadatos) = 'null' then
    return false;
  end if;

  if jsonb_typeof(p_metadatos) <> 'object' then
    return false;
  end if;

  if (select count(*) from jsonb_object_keys(p_metadatos)) <> 4 then
    return false;
  end if;

  if not (p_metadatos ? 'modelo'
          and p_metadatos ? 'duracion_ms'
          and p_metadatos ? 'motivo_finalizacion'
          and p_metadatos ? 'caracteres_respuesta') then
    return false;
  end if;

  if jsonb_typeof(p_metadatos -> 'modelo') <> 'string'
     or length(trim(p_metadatos ->> 'modelo')) = 0
     or length(p_metadatos ->> 'modelo') > 80 then
    return false;
  end if;

  -- motivo_finalizacion: enumerado cerrado del proveedor (STOP,
  -- MAX_TOKENS, SAFETY...) o null cuando no vino ninguno.
  v_valor := p_metadatos -> 'motivo_finalizacion';
  if jsonb_typeof(v_valor) <> 'null' then
    if jsonb_typeof(v_valor) <> 'string'
       or length(trim(v_valor #>> '{}')) = 0
       or length(v_valor #>> '{}') > 40 then
      return false;
    end if;
  end if;

  v_valor := p_metadatos -> 'duracion_ms';
  if jsonb_typeof(v_valor) <> 'number'
     or (v_valor #>> '{}')::numeric <> trunc((v_valor #>> '{}')::numeric)
     or (v_valor #>> '{}')::numeric < 0
     or (v_valor #>> '{}')::numeric > 3600000 then
    return false;
  end if;

  -- caracteres_respuesta debe ser >= 1: una respuesta real del proveedor
  -- siempre tiene texto. Un cero significaria que no hubo respuesta que
  -- analizar, y entonces no hay analisis que conservar.
  v_valor := p_metadatos -> 'caracteres_respuesta';
  if jsonb_typeof(v_valor) <> 'number'
     or (v_valor #>> '{}')::numeric <> trunc((v_valor #>> '{}')::numeric)
     or (v_valor #>> '{}')::numeric < 1
     or (v_valor #>> '{}')::numeric > 1000000 then
    return false;
  end if;

  return true;
end;
$$;

-- Permisos de las dos funciones de validacion.
--
-- Ningun rol de la API las invoca: solo se usan dentro de los CHECK de la
-- tabla y dentro de la RPC. Los CHECK se evaluan con los privilegios de
-- quien ejecuta el INSERT, y el unico que inserta es la RPC, que es
-- SECURITY DEFINER y corre como su propietario. Por eso NO hace falta
-- conceder EXECUTE a authenticated -- a diferencia de
-- es_respuestas_diagnostico_valido() en 0001, que si lo necesita porque
-- authenticated conserva INSERT directo sobre public.diagnosticos.
--
-- Cada REVOKE va en su propia sentencia, con la firma completa, para que
-- quede auditable uno por uno.
revoke all on function public.es_analisis_adaptativo_valido (jsonb) from public;
revoke all on function public.es_analisis_adaptativo_valido (jsonb) from anon;
revoke all on function public.es_analisis_adaptativo_valido (jsonb) from authenticated;

revoke all on function public.es_metadatos_analisis_valido (jsonb) from public;
revoke all on function public.es_metadatos_analisis_valido (jsonb) from anon;
revoke all on function public.es_metadatos_analisis_valido (jsonb) from authenticated;

-- ----------------------------------------------------------------
-- 3. TABLA: analisis_adaptativos
--
-- Historial versionado del perfil educativo. Cada fila es UNA decision de
-- Gemini ligada por intento_id a la evidencia concreta que la origino.
-- Nada se sobrescribe: conservar la version anterior es lo que permite
-- demostrar que la segunda decision partio de la primera.
--
-- "version": columna IDENTITY, estrictamente creciente. Existe porque
-- ordenar por "fecha" NO es determinista -- now() devuelve el instante de
-- inicio de la transaccion, de modo que dos filas pueden compartir marca
-- de tiempo y el "ultimo analisis" quedaria indefinido. La aplicacion
-- ordena por version, no por fecha (ver src/app/api/adaptar/route.ts).
--
--   QUE GARANTIZA Y QUE NO, sin ambiguedad: IDENTITY da un orden
--   DETERMINISTA DE ASIGNACION -- dos filas nunca comparten version y la
--   comparacion "mayor version" siempre tiene una respuesta unica. NO
--   garantiza el orden de FINALIZACION de transacciones concurrentes: si
--   dos transacciones se solapan, la que obtuvo la version mas alta puede
--   confirmar antes que la otra, y durante ese intervalo un lector veria
--   la version alta sin ver la baja. Tampoco garantiza continuidad: las
--   secuencias dejan huecos si una transaccion se revierte.
--
--   Para este producto eso basta y sobra: cada estudiante tiene una
--   peticion en vuelo a la vez (el ciclo es secuencial por definicion --
--   no hay segunda respuesta hasta que la primera devuelve su analisis),
--   de modo que asignacion y confirmacion coinciden. Lo que se afirma es
--   "el orden es determinista", no "el orden es el de confirmacion".
--
-- "usuario_id" es redundante con intentos.usuario_id, y se conserva a
-- proposito: permite que la policy de RLS y el indice trabajen sobre esta
-- tabla sin recorrer public.intentos en cada lectura. La coherencia entre
-- ambos NO se deja al azar: la RPC toma usuario_id DE LA PROPIA FILA del
-- intento (ver mas abajo), no de un parametro ni de una segunda lectura
-- de auth.uid(). No se anade una clave foranea compuesta contra
-- (intentos.id, intentos.usuario_id) porque exigiria crear un UNIQUE
-- nuevo sobre public.intentos, y esta migracion no altera tablas
-- existentes.
--
-- "metadatos": modelo, duracion, motivo de finalizacion y tamano de la
-- respuesta. NUNCA la clave, la URL, las cabeceras ni el prompt.
--
-- Restriccion unica sobre intento_id: una sola decision por evidencia.
-- Es la prevencion de duplicados a nivel de esquema, la unica que cierra
-- de verdad la ventana entre dos peticiones simultaneas que la
-- comprobacion previa en la aplicacion no puede cerrar por si sola. Va
-- con nombre explicito para poder referenciarla desde ON CONFLICT.
--
-- Se usa "create table" y no "create table if not exists" a proposito: si
-- la tabla ya existiera, "if not exists" la daria por buena en silencio
-- SIN aplicar los CHECK ni la restriccion unica de este archivo, y la
-- migracion parecería exitosa con un esquema distinto del descrito. Con
-- "create table", una segunda aplicacion aborta la transaccion completa y
-- no cambia nada.
-- ----------------------------------------------------------------
create table public.analisis_adaptativos (
  id uuid primary key default gen_random_uuid(),
  version bigint generated always as identity,
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  intento_id uuid not null references public.intentos (id) on delete cascade,
  analisis jsonb not null check (public.es_analisis_adaptativo_valido(analisis)),
  metadatos jsonb not null check (public.es_metadatos_analisis_valido(metadatos)),
  fecha timestamptz not null default now(),
  constraint analisis_adaptativos_intento_unico unique (intento_id)
);

-- Indice de la consulta real del ciclo: "el ultimo analisis de este
-- usuario" (order by version desc limit 1, con RLS filtrando por
-- usuario_id).
create index idx_analisis_adaptativos_usuario_version
  on public.analisis_adaptativos (usuario_id, version desc);

alter table public.analisis_adaptativos enable row level security;

-- Unica policy: lectura del propio historial. NO se crea policy de
-- INSERT, UPDATE ni DELETE. Sin policy permisiva, RLS bloquea esas
-- operaciones para anon y authenticated aunque alguien concediera el
-- privilegio por error: hacen falta las dos cosas, y aqui no hay ninguna.
create policy analisis_select_propio
  on public.analisis_adaptativos
  for select
  to authenticated
  using (auth.uid() = usuario_id);

-- GRANTS explicitos (defensa en profundidad ademas de RLS).
--
-- El REVOKE inicial NO es decorativo: Supabase define privilegios por
-- defecto sobre el esquema public, de modo que una tabla recien creada
-- puede quedar con permisos amplios para anon y authenticated sin que
-- este archivo los haya concedido. Se retiran todos y se devuelve
-- unicamente SELECT a authenticated.
revoke all on public.analisis_adaptativos from anon, authenticated;
grant select on public.analisis_adaptativos to authenticated;

-- service_role tambien pierde la escritura DIRECTA sobre esta tabla.
--
-- Es el punto que evita que la credencial de servidor se convierta en un
-- permiso mas amplio de lo necesario: el servidor solo necesita poder
-- EJECUTAR la RPC, no insertar filas a mano. Retirandole INSERT/UPDATE/
-- DELETE, ni siquiera con la clave secreta se puede escribir un analisis
-- saltandose la validacion, la unicidad por intento o la derivacion de
-- usuario_id. La RPC sigue funcionando porque es SECURITY DEFINER y se
-- ejecuta con los privilegios de su propietario, no con los de quien la
-- llama.
revoke all on public.analisis_adaptativos from service_role;
grant select on public.analisis_adaptativos to service_role;

-- La columna IDENTITY crea una secuencia implicita
-- (public.analisis_adaptativos_version_seq). Le aplica el mismo
-- razonamiento: ningun rol de la API la necesita, porque ninguno inserta.
-- Solo la usa la RPC, que corre como su propietario.
revoke all on sequence public.analisis_adaptativos_version_seq from anon, authenticated, service_role;

-- ----------------------------------------------------------------
-- 4. RPC: guardar_analisis_adaptativo
--
-- Unica via por la que se escribe public.analisis_adaptativos.
--
-- QUIEN PUEDE LLAMARLA: solo el servidor. anon y authenticated NO reciben
-- EXECUTE, de modo que el navegador no puede invocarla ni desde la
-- consola. Es lo que impide que un usuario cuelgue de su propio intento
-- un JSON que Gemini nunca produjo.
--
-- Seguridad (mismo patron que registrar_intento() en 0003 y
-- guardar_diagnostico_con_perfil() en 0004, con una diferencia
-- deliberada en la identidad):
--   - SECURITY DEFINER con "set search_path = pg_catalog", de modo que la
--     resolucion de nombres no depende del search_path del llamante;
--   - la funcion NO acepta ningun identificador de usuario: es imposible
--     escribir el historial de otra persona aunque se manipule por
--     completo la peticion;
--   - el propietario se toma de la FILA DEL INTENTO. Esa fila solo pudo
--     crearla registrar_intento() ejecutandose con el token del propio
--     estudiante, asi que usuario_id no puede discrepar de quien respondio
--     ni siquiera por un error de programacion posterior.
--
-- POR QUE AQUI NO SE EXIGE auth.uid() NO NULO, a diferencia de 0003 y
-- 0004: bajo la credencial de servidor no hay usuario en sesion y
-- auth.uid() es nulo por definicion. Exigirlo haria imposible la unica
-- llamada legitima. La verificacion de sesion no desaparece: ocurre antes,
-- en /api/adaptar, contra el servidor de Auth (getUser(token)), y sin ella
-- no se llega siquiera a registrar el intento.
--
-- Aun asi, si alguna vez la funcion se invocara CON una sesion (por
-- ejemplo si un cambio futuro volviera a concederla a authenticated), se
-- exige que esa identidad coincida con el dueno del intento. Es una
-- guardia que hoy no se ejercita y que existe para que ese cambio futuro
-- no reabra el agujero en silencio.
--
-- NOMBRES DE LOS PARAMETROS DE SALIDA: se llaman "analisis_id",
-- "analisis_version" y "creado_en", deliberadamente DISTINTOS de las
-- columnas "id", "version" y "fecha". En plpgsql los parametros de salida
-- son variables visibles en toda la funcion, y una referencia sin
-- calificar que coincida con el nombre de una columna aborta con 42702 --
-- exactamente el fallo que obligo a escribir la migracion 0003. Aqui se
-- evita por partida doble: nombres distintos Y todas las referencias
-- calificadas con el alias "a".
--
-- IDEMPOTENCIA ANTE REINTENTOS: si ya existe un analisis para ese
-- intento, se devuelve el que hay. No se sobrescribe: la decision
-- original es historial. La insercion usa "on conflict do nothing" en vez
-- de comprobar antes y luego insertar, porque comprobar-y-luego-insertar
-- deja una ventana entre ambas sentencias en la que dos peticiones
-- simultaneas pasan las dos la comprobacion y la segunda muere con 23505.
--
-- VENTANA RESIDUAL, declarada y no disimulada: "on conflict do nothing"
-- no espera a una transaccion concurrente que aun no ha confirmado su
-- insercion; simplemente no inserta. En ese caso el SELECT posterior
-- tampoco vera la fila (READ COMMITTED) y la funcion lanza una excepcion
-- controlada en lugar de devolver cero filas en silencio. La aplicacion
-- la interpreta como "no conservado" y el usuario ve un estado
-- recuperable. Es una ventana de milisegundos que ademas exige dos
-- peticiones simultaneas del MISMO usuario sobre el MISMO intento; se
-- prefiere un fallo ruidoso y honesto antes que un exito inventado.
-- ----------------------------------------------------------------
create or replace function public.guardar_analisis_adaptativo (
  p_intento_id uuid,
  p_analisis jsonb,
  p_metadatos jsonb default null
)
returns table (
  analisis_id uuid,
  analisis_version bigint,
  creado_en timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_llamante uuid := auth.uid();
  v_usuario_id uuid;
  v_id uuid;
  v_version bigint;
  v_creado_en timestamptz;
begin
  -- El propietario sale de la FILA DEL INTENTO, nunca de un parametro ni
  -- del JSON. Si el intento no existe, no hay nada de que colgar un
  -- analisis.
  select i.usuario_id
    into v_usuario_id
    from public.intentos i
   where i.id = p_intento_id;

  if not found then
    raise exception 'El intento no existe';
  end if;

  -- Guardia para un futuro en el que esta funcion volviera a invocarse
  -- con una sesion de usuario: esa identidad tendria que ser la del dueno
  -- del intento. Hoy no se ejercita (el servidor llama sin sesion), pero
  -- impide que un cambio de permisos posterior reabra el agujero sin que
  -- nadie se de cuenta.
  if v_llamante is not null and v_llamante <> v_usuario_id then
    raise exception 'El intento no pertenece al usuario en sesion';
  end if;

  if not public.es_analisis_adaptativo_valido(p_analisis) then
    raise exception 'Analisis adaptativo invalido';
  end if;

  if not public.es_metadatos_analisis_valido(p_metadatos) then
    raise exception 'Metadatos de analisis invalidos';
  end if;

  insert into public.analisis_adaptativos as a (usuario_id, intento_id, analisis, metadatos)
  values (v_usuario_id, p_intento_id, p_analisis, p_metadatos)
  on conflict on constraint analisis_adaptativos_intento_unico do nothing
  returning a.id, a.version, a.fecha into v_id, v_version, v_creado_en;

  if v_id is null then
    -- Reintento: ya habia un analisis para este intento. Se devuelve el
    -- existente, sin tocarlo.
    select a.id, a.version, a.fecha
      into v_id, v_version, v_creado_en
      from public.analisis_adaptativos a
     where a.intento_id = p_intento_id;

    if not found then
      raise exception 'No se pudo conservar el analisis: escritura concurrente sobre el mismo intento';
    end if;
  end if;

  return query select v_id, v_version, v_creado_en;
end;
$$;

-- PERMISOS EXPLICITOS DE LA RPC.
--
-- PostgreSQL concede EXECUTE a PUBLIC por defecto al crear una funcion.
-- En una SECURITY DEFINER eso es especialmente delicado, porque se
-- ejecutaria con los privilegios del propietario. Se revoca de PUBLIC,
-- de anon y de authenticated en sentencias separadas y con la firma
-- completa, para que quede auditable una por una, y se concede
-- unicamente a service_role -- el rol bajo el que el servidor presenta su
-- credencial exclusiva.
--
-- Contraste deliberado con 0003 y 0004, donde SI se concede a
-- authenticated: alli el cliente escribe DATOS SUYOS (su respuesta, su
-- diagnostico) y la base de datos calcula el resultado objetivo. Aqui el
-- cliente escribiria una DECISION ATRIBUIDA A GEMINI, y ninguna
-- validacion puede distinguir una decision real de una inventada con la
-- forma correcta. Por eso el permiso cambia de rol.
revoke all on function public.guardar_analisis_adaptativo (uuid, jsonb, jsonb) from public;
revoke all on function public.guardar_analisis_adaptativo (uuid, jsonb, jsonb) from anon;
revoke all on function public.guardar_analisis_adaptativo (uuid, jsonb, jsonb) from authenticated;
grant execute on function public.guardar_analisis_adaptativo (uuid, jsonb, jsonb) to service_role;

commit;
