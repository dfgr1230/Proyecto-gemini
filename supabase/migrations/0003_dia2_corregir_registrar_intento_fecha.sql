-- ================================================================
-- Dia 2 -- Correccion minima: ambiguedad de columna "fecha" en
-- registrar_intento()
-- Archivo: supabase/migrations/0003_dia2_corregir_registrar_intento_fecha.sql
-- ESTADO: PROPUESTA -- NO EJECUTAR SIN AUTORIZACION EXPRESA POSTERIOR
--
-- Contexto: la cuarta ejecucion real de scripts/checkpoint5-intentos.mjs
-- reporto, en la llamada valida a registrar_intento(), el error de
-- Postgres 42702 "column reference "fecha" is ambiguous".
--
-- Causa exacta (confirmada leyendo 0001_dia2_esquema_base.sql):
--   "returns table (intento_id uuid, es_correcto boolean, fecha
--   timestamptz)" declara "fecha" como parametro de salida -- que
--   plpgsql trata como una variable mas, visible en toda la funcion.
--   public.intentos tambien tiene una columna real llamada "fecha".
--   La sentencia:
--
--     insert into public.intentos (...)
--     values (...)
--     returning id, correcto, fecha into v_intento_id, v_es_correcto, v_fecha;
--
--   hace referencia a "fecha" sin calificar. Esa referencia coincide a
--   la vez con la columna intentos.fecha y con el parametro de salida
--   "fecha": plpgsql (con la configuracion por defecto
--   #variable_conflict = error) no seguido de una eleccion implicita,
--   sino que aborta con 42702. "id" y "correcto" no tienen este
--   problema porque los parametros de salida homologos se llaman
--   "intento_id" y "es_correcto", nombres distintos.
--
-- Correccion: calificar la lista de RETURNING con un alias de la
-- tabla destino ("i"), para que "i.id", "i.correcto" e "i.fecha" solo
-- puedan resolverse contra las columnas de public.intentos, nunca
-- contra los parametros de salida de la funcion. No se renombra
-- ninguna columna de tabla ni ningun parametro de salida publico.
--
-- Todo lo demas se conserva identico a la version original en 0001:
-- misma firma publica (nombre, parametros, tipos, returns table),
-- mismo calculo server-side de "correcto" (comparacion
-- case-insensitive, trim, contra ejercicios_respuestas), misma
-- comprobacion de autenticacion (auth.uid() nulo -> excepcion), misma
-- verificacion implicita de propiedad (usuario_id = auth.uid() en el
-- INSERT), mismo SECURITY DEFINER, mismo "set search_path =
-- pg_catalog", y los mismos GRANT/REVOKE (revoke all ... from public,
-- anon; grant execute ... to authenticated), repetidos aqui solo para
-- que esta migracion sea autocontenida e idempotente si se reaplica.
--
-- Fuera de alcance deliberado: no se tocan las migraciones 0001 ni
-- 0002 (ya aplicadas), ni scripts/checkpoint5-intentos.mjs, ni ningun
-- otro archivo.
--
-- IMPORTANTE: este archivo NO ha sido ejecutado. No se ha contactado
-- Supabase para aplicarlo. Requiere autorizacion expresa posterior,
-- independiente de la que crea o corrige este archivo.
-- ================================================================

begin;

create or replace function public.registrar_intento (
  p_ejercicio_id uuid,
  p_respuesta_dada text,
  p_tiempo_respuesta int default null
)
returns table (
  intento_id uuid,
  es_correcto boolean,
  fecha timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_usuario_id uuid := auth.uid();
  v_respuesta_dada text;
  v_respuesta_oficial text;
  v_es_correcto boolean;
  v_intento_id uuid;
  v_fecha timestamptz;
begin
  if v_usuario_id is null then
    raise exception 'No autenticado';
  end if;

  v_respuesta_dada := trim(coalesce(p_respuesta_dada, ''));

  if v_respuesta_dada = '' then
    raise exception 'respuesta_dada no puede estar vacia';
  end if;

  if p_tiempo_respuesta is not null
     and (p_tiempo_respuesta < 0 or p_tiempo_respuesta > 3600) then
    raise exception 'tiempo_respuesta fuera de rango permitido (0-3600 segundos)';
  end if;

  select er.respuesta_correcta
    into v_respuesta_oficial
    from public.ejercicios_respuestas er
   where er.ejercicio_id = p_ejercicio_id;

  if not found then
    raise exception 'Ejercicio no encontrado: %', p_ejercicio_id;
  end if;

  v_es_correcto := (
    lower(trim(v_respuesta_dada)) = lower(trim(v_respuesta_oficial))
  );

  insert into public.intentos as i (usuario_id, ejercicio_id, respuesta_dada, correcto, tiempo_respuesta)
  values (v_usuario_id, p_ejercicio_id, v_respuesta_dada, v_es_correcto, p_tiempo_respuesta)
  returning i.id, i.correcto, i.fecha into v_intento_id, v_es_correcto, v_fecha;

  return query select v_intento_id, v_es_correcto, v_fecha;
end;
$$;

revoke all on function public.registrar_intento (uuid, text, int) from public, anon;
grant execute on function public.registrar_intento (uuid, text, int) to authenticated;

commit;
