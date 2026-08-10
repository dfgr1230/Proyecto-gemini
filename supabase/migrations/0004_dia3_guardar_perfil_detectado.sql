-- ================================================================
-- Dia 3 -- Persistencia del perfil educativo generado por Gemini
-- Archivo: supabase/migrations/0004_dia3_guardar_perfil_detectado.sql
-- ESTADO: PROPUESTA -- NO EJECUTAR SIN AUTORIZACION EXPRESA POSTERIOR
--
-- POR QUE ES NECESARIA (comprobado leyendo 0001_dia2_esquema_base.sql,
-- no supuesto):
--   public.diagnosticos tiene RLS con dos policies para authenticated,
--   "diagnosticos_select_propio" (SELECT) y "diagnosticos_insert_propio"
--   (INSERT). Los GRANT son:
--
--     grant select on public.diagnosticos to authenticated;
--     grant insert (usuario_id, respuestas) on public.diagnosticos to authenticated;
--
--   La columna "perfil_detectado" NO esta en el GRANT de INSERT, y no
--   existe ninguna policy de UPDATE sobre la tabla. Con el esquema
--   vigente, por tanto, el perfil generado por Gemini NO se puede
--   persistir de ninguna manera desde el cliente autenticado. Esta
--   migracion existe unicamente para cerrar ese hueco.
--
-- POR QUE UNA RPC Y NO UNA POLICY DE UPDATE:
--   Abrir "grant update (perfil_detectado)" + una policy de UPDATE
--   permitiria que cualquier navegador autenticado escribiera en esa
--   columna un JSON arbitrario -- incluido uno con etiquetas clinicas o
--   con campos inventados. Una funcion SECURITY DEFINER concentra la
--   escritura en un unico punto y permite VALIDAR la estructura dentro
--   de la propia base de datos, que es la unica frontera que el cliente
--   no puede saltarse. Se sigue exactamente el mismo criterio que ya
--   uso 0001 con registrar_intento(): el cliente no puede decidir el
--   contenido de una columna sensible.
--
-- POR QUE UNA SOLA OPERACION ATOMICA (respuestas + perfil juntos):
--   public.diagnosticos.usuario_id es UNIQUE (1:1 con el usuario) y no
--   existe ninguna policy de DELETE. Si se insertaran primero las
--   respuestas y la generacion del perfil fallara despues, ese unico
--   diagnostico permitido quedaria ocupado y SIN perfil, sin ninguna via
--   para reintentar ni para corregirlo desde la aplicacion. Insertando
--   ambas cosas a la vez, y solo cuando el perfil ya es valido, un fallo
--   de red o del proveedor no deja ningun rastro y el estudiante puede
--   reintentar conservando sus respuestas.
--
-- LO QUE ESTA MIGRACION NO HACE (por diseno):
--   - No modifica, duplica ni reemplaza 0001, 0002 ni 0003.
--   - No altera ninguna tabla, columna, CHECK, policy ni GRANT existente.
--   - No desactiva ni debilita RLS en ninguna tabla.
--   - No concede UPDATE ni DELETE sobre public.diagnosticos a nadie.
--   - No introduce ninguna clave service_role ni permiso administrativo
--     para el cliente.
--   - No toca es_respuestas_diagnostico_valido(): se REUTILIZA tal cual.
--
-- IMPORTANTE: este archivo NO ha sido ejecutado. No se ha contactado
-- Supabase para aplicarlo. Requiere autorizacion expresa posterior,
-- independiente de la que crea este archivo.
-- ================================================================

begin;

-- ----------------------------------------------------------------
-- FUNCION DE VALIDACION: es_perfil_detectado_valido
--
-- Funcion pura (IMMUTABLE, SECURITY INVOKER): solo lee su parametro, no
-- toca ninguna tabla. Espeja el contrato de
-- src/lib/diagnostico/contrato.ts:
--
--   {
--     "estilo_aprendizaje": "visual" | "auditivo" | "lectoescritor" | "kinestesico",
--     "nivel_sugerido": entero 1..5,
--     "explicacion": texto no vacio, maximo 400 caracteres
--   }
--
-- Se exigen EXACTAMENTE esas tres claves: ni una menos, ni una mas. El
-- rechazo de propiedades adicionales es deliberado -- es lo que impide
-- que un modelo introduzca campos que este producto no debe almacenar
-- (probabilidades, etiquetas clinicas, datos inferidos).
--
-- El rango 1..5 de "nivel_sugerido" coincide a proposito con el CHECK de
-- public.ejercicios.nivel_dificultad definido en 0001 (between 1 and 5),
-- para que el nivel del perfil sea directamente utilizable al elegir
-- ejercicios.
--
-- VOCABULARIO CLINICO (corregido en F1-A1R):
--
-- La primera version de esta migracion delegaba el filtro de vocabulario
-- clinico exclusivamente en la capa de aplicacion
-- (src/lib/diagnostico/contrato.ts), para no duplicar la lista. Ese
-- razonamiento era INCORRECTO y aqui queda corregido: la RPC de mas
-- abajo esta expuesta a "authenticated", de modo que un usuario
-- autenticado puede invocarla DIRECTAMENTE (por ejemplo desde la consola
-- del navegador con el cliente de Supabase) sin pasar nunca por
-- /api/perfil. Si la unica barrera clinica viviera en TypeScript, seria
-- trivial almacenar un perfil con etiquetas clinicas saltandose la ruta
-- de servidor.
--
-- Por eso la base de datos aplica ahora el MISMO limite. Las dos listas
-- deben mantenerse en paridad; una prueba automatizada
-- (src/lib/diagnostico/contrato.test.mjs) compara la lista exportada de
-- TypeScript contra el texto de este archivo y falla si alguna raiz
-- falta en cualquiera de los dos lados.
--
-- NORMALIZACION CANONICA (corregida en F1-A1R2):
--
-- La version anterior usaba translate() sobre un conjunto fijo de
-- vocales acentuadas precompuestas. Eso dejaba un HUECO REAL: el texto
-- Unicode DESCOMPUESTO (NFD) no se veia afectado. La cadena
-- "diagno" || U+0301 || "stico cli" || U+0301 || "nico" se muestra
-- identica a "diagnostico clinico" con tildes, pero translate() no
-- elimina la marca combinante U+0301, de modo que la raiz
-- "diagnostico clinico" no coincidia y el perfil se aceptaba. TypeScript
-- si lo detectaba (aplica NFD), asi que las dos capas NO estaban en
-- paridad real. Como "authenticated" puede invocar la RPC directamente,
-- era un atajo efectivo alrededor de esta barrera.
--
-- Estrategia actual, identica a la de TypeScript
-- (canonizarParaComparar en src/lib/diagnostico/contrato.ts):
--   1. normalize(texto, NFD)  -> separa cada letra de sus diacriticos;
--   2. lower(...)             -> minusculas;
--   3. regexp_replace('[^a-z0-9]', '', 'g') -> conserva SOLO letras
--      ASCII y digitos, descartando marcas combinantes, espacios,
--      puntos, guiones y cualquier otro signo.
--
-- Ademas de las tildes descompuestas, esto cierra los separadores
-- evasivos ("T.D.A.H." -> "tdah", "diag-nostico" -> "diagnostico") y los
-- espacios irregulares ("deficit  de atencion" -> "deficitdeatencion").
--
-- La MISMA transformacion se aplica a cada raiz antes de comparar, de
-- modo que las raices de varias palabras pierden sus espacios igual que
-- el texto y siguen coincidiendo.
--
-- Sin extensiones: normalize() y regexp_replace() son funciones nativas
-- de PostgreSQL (normalize existe desde la version 13). NO se usa
-- "unaccent" y no se crea ninguna extension. La eliminacion de tildes no
-- depende de la configuracion regional, porque no se apoya en el
-- comportamiento de lower() con caracteres acentuados: los diacriticos
-- se descartan por su categoria, ya separados por NFD.
--
-- Requisito para F1-A2: confirmar que server_encoding es UTF8 antes de
-- aplicar esta migracion -- normalize() exige codificacion UTF8.
--
-- IMMUTABLE se conserva: normalize(), lower(), regexp_replace() y
-- position() son todas inmutables, y la lista de raices es una constante
-- literal dentro del cuerpo -- no se consulta ninguna tabla.
-- ----------------------------------------------------------------
create or replace function public.es_perfil_detectado_valido(p_perfil jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_estilo text;
  v_nivel jsonb;
  v_explicacion text;
  v_normalizada text;
  v_raiz text;
  -- Paridad exacta con RAICES_CLINICAS_PROHIBIDAS en
  -- src/lib/diagnostico/contrato.ts (mismas raices, sin acentos).
  v_raices_prohibidas text[] := array[
    'asperger',
    'autis',
    'tdah',
    'deficit de atencion',
    'dislexi',
    'discapacidad',
    'trastorno',
    'sindrome',
    'patolog',
    'diagnostico clinico',
    'terapia',
    'terapeut',
    'tratamiento',
    'medicac',
    'psicolog',
    'psiquiatr',
    'clinic',
    'coeficiente intelectual',
    'retraso'
  ];
begin
  if p_perfil is null or jsonb_typeof(p_perfil) <> 'object' then
    return false;
  end if;

  -- Exactamente tres claves, y exactamente las esperadas.
  if (select count(*) from jsonb_object_keys(p_perfil)) <> 3 then
    return false;
  end if;

  if not (p_perfil ? 'estilo_aprendizaje'
          and p_perfil ? 'nivel_sugerido'
          and p_perfil ? 'explicacion') then
    return false;
  end if;

  -- estilo_aprendizaje: string dentro del vocabulario cerrado.
  if jsonb_typeof(p_perfil -> 'estilo_aprendizaje') <> 'string' then
    return false;
  end if;
  v_estilo := p_perfil ->> 'estilo_aprendizaje';
  if v_estilo not in ('visual', 'auditivo', 'lectoescritor', 'kinestesico') then
    return false;
  end if;

  -- nivel_sugerido: numero entero entre 1 y 5. Se comprueba que sea
  -- numerico ANTES de convertirlo, y que no tenga parte decimal.
  v_nivel := p_perfil -> 'nivel_sugerido';
  if jsonb_typeof(v_nivel) <> 'number' then
    return false;
  end if;
  if (v_nivel #>> '{}')::numeric <> trunc((v_nivel #>> '{}')::numeric) then
    return false;
  end if;
  if (v_nivel #>> '{}')::numeric < 1 or (v_nivel #>> '{}')::numeric > 5 then
    return false;
  end if;

  -- explicacion: texto no vacio, longitud acotada.
  if jsonb_typeof(p_perfil -> 'explicacion') <> 'string' then
    return false;
  end if;
  v_explicacion := p_perfil ->> 'explicacion';
  if length(trim(v_explicacion)) = 0 or length(v_explicacion) > 400 then
    return false;
  end if;

  -- Vocabulario clinico. La explicacion se reduce a su forma canonica
  -- (NFD -> minusculas -> solo a-z0-9) y cada raiz se reduce con la
  -- MISMA transformacion antes de compararlas. Ante cualquier
  -- coincidencia se rechaza el perfil COMPLETO: no se recorta, no se
  -- reescribe y no se "limpia" la explicacion para poder aceptarla --
  -- el valor que se persiste es siempre el original.
  v_normalizada := regexp_replace(lower(normalize(v_explicacion, NFD)), '[^a-z0-9]', '', 'g');

  foreach v_raiz in array v_raices_prohibidas loop
    if position(
         regexp_replace(lower(normalize(v_raiz, NFD)), '[^a-z0-9]', '', 'g')
         in v_normalizada
       ) > 0 then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

-- Permisos de la funcion de validacion: NO la invoca ningun cliente.
-- Solo la usa guardar_diagnostico_con_perfil(), que es SECURITY DEFINER
-- y por tanto se ejecuta con los privilegios de su propietario. Por eso
-- se retira la ejecucion a todos los roles de la API, incluido
-- authenticated.
--
-- (Contraste deliberado con es_respuestas_diagnostico_valido() de 0001,
-- que SI conserva EXECUTE para authenticated: aquella se evalua dentro
-- del CHECK de public.diagnosticos.respuestas, con los privilegios de
-- quien ejecuta el INSERT. Esta no participa en ningun CHECK.)
revoke all on function public.es_perfil_detectado_valido (jsonb) from public;
revoke all on function public.es_perfil_detectado_valido (jsonb) from anon;
revoke all on function public.es_perfil_detectado_valido (jsonb) from authenticated;

-- ----------------------------------------------------------------
-- RPC: guardar_diagnostico_con_perfil
--
-- Unica via por la que se escribe public.diagnosticos.perfil_detectado.
--
-- Seguridad (mismo patron que registrar_intento() en 0001):
--   - SECURITY DEFINER con "set search_path = pg_catalog": la resolucion
--     de nombres no depende del search_path del llamante.
--   - auth.uid() se usa completamente calificado (esquema "auth"), por lo
--     que sigue resolviendo correctamente sin "public" en el search_path.
--   - El usuario propietario se toma SIEMPRE de auth.uid(), NUNCA de un
--     parametro: es imposible que un usuario escriba el diagnostico de
--     otro, aunque manipule por completo la peticion.
--   - Sin sesion (auth.uid() nulo) -> excepcion inmediata.
--   - anon no recibe EXECUTE.
--
-- Idempotencia y reintentos: si el usuario ya tiene un diagnostico, la
-- funcion lanza una excepcion controlada en vez de sobrescribirlo. No se
-- usa "on conflict do update" a proposito: un diagnostico ya generado es
-- un dato del estudiante y no debe reemplazarse en silencio por una
-- segunda ejecucion accidental.
-- ----------------------------------------------------------------
create or replace function public.guardar_diagnostico_con_perfil (
  p_respuestas jsonb,
  p_perfil jsonb
)
returns table (
  diagnostico_id uuid,
  fecha timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_usuario_id uuid := auth.uid();
  v_diagnostico_id uuid;
  v_fecha timestamptz;
begin
  if v_usuario_id is null then
    raise exception 'No autenticado';
  end if;

  if not public.es_respuestas_diagnostico_valido(p_respuestas) then
    raise exception 'Respuestas de diagnostico invalidas';
  end if;

  if not public.es_perfil_detectado_valido(p_perfil) then
    raise exception 'Perfil detectado invalido';
  end if;

  if exists (select 1 from public.diagnosticos d where d.usuario_id = v_usuario_id) then
    raise exception 'El usuario ya tiene un diagnostico registrado';
  end if;

  insert into public.diagnosticos as d (usuario_id, respuestas, perfil_detectado)
  values (v_usuario_id, p_respuestas, p_perfil)
  returning d.id, d.fecha into v_diagnostico_id, v_fecha;

  return query select v_diagnostico_id, v_fecha;
end;
$$;

-- ----------------------------------------------------------------
-- PERMISOS EXPLICITOS DE LA RPC (endurecidos en F1-A1R)
--
-- PostgreSQL concede EXECUTE a PUBLIC por defecto al crear una funcion.
-- En una funcion SECURITY DEFINER eso es especialmente delicado, porque
-- se ejecutaria con los privilegios del propietario. Por eso se revoca
-- explicitamente de PUBLIC y de anon ANTES de conceder nada, y se
-- concede unicamente a authenticated.
--
-- Cada REVOKE va en su propia sentencia, con la firma completa
-- (jsonb, jsonb), para que quede auditable uno por uno y no dependa de
-- interpretar una lista separada por comas.
--
-- No se concede ningun permiso administrativo, no se menciona
-- service_role, y no se otorga UPDATE, INSERT ni ningun acceso directo
-- sobre public.diagnosticos.perfil_detectado a ningun rol.
-- ----------------------------------------------------------------
revoke all on function public.guardar_diagnostico_con_perfil (jsonb, jsonb) from public;
revoke all on function public.guardar_diagnostico_con_perfil (jsonb, jsonb) from anon;
grant execute on function public.guardar_diagnostico_con_perfil (jsonb, jsonb) to authenticated;

commit;
