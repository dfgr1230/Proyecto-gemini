-- ================================================================
-- Dia 2 -- Carga minima de un (1) ejercicio de prueba (semilla tecnica)
-- Archivo: supabase/migrations/0002_dia2_seed_ejercicio_minimo.sql
-- ESTADO: PROPUESTA -- NO EJECUTAR SIN AUTORIZACION EXPRESA POSTERIOR
--
-- Contexto: se confirmo visualmente en Supabase Dashboard -> Table
-- Editor que public.ejercicios tenia 0 records. Esa tabla vacia es la
-- causa demostrada de que la tercera ejecucion de
-- scripts/checkpoint5-intentos.mjs terminara en "precondicion_incumplida"
-- (ver scripts/lib/checkpoint5-logica.mjs, clasificarPrecondicionEjercicio)
-- antes de poder probar registrar_intento(). Esta migracion existe
-- unicamente para desbloquear esa precondicion -- no ejecuta, por si
-- misma, ninguna prueba del Checkpoint 5 ni contacta Supabase.
--
-- Esta fila es una SEMILLA TECNICA DE VALIDACION, no el banco
-- pedagogico definitivo: enunciado y opciones son un ejercicio real,
-- simple y controlado (2 + 3), suficiente para que el flujo de
-- registrar_intento() se ejercite de extremo a extremo, pero el
-- contenido educativo real del producto se definira en una etapa
-- posterior, con una decision pedagogica separada.
--
-- Contrato de las tablas (supabase/migrations/0001_dia2_esquema_base.sql):
--   - ejercicios.materia: check (materia in ('matematicas', 'lenguaje'))
--   - ejercicios.nivel_dificultad: check (between 1 and 5)
--   - ejercicios.contenido: check (jsonb_typeof(contenido) = 'object')
--     -- el CHECK exige unicamente que sea un objeto JSON; no exige que
--     -- el objeto sea "no vacio" (aqui se llena con enunciado/opciones
--     -- por diseno del ejercicio, no porque el esquema lo obligue).
--   - ejercicios_respuestas.ejercicio_id: primary key, references
--     ejercicios(id) on delete cascade (relacion 1:1).
--   - ejercicios_respuestas.respuesta_correcta: check (char_length(trim(...)) > 0)
--
-- Proteccion de la respuesta oficial: sin cambios. public.ejercicios_respuestas
-- sigue con RLS activo sin ninguna policy, y "revoke all ... from anon,
-- authenticated" (ver 0001). Esta migracion se aplicaria, igual que
-- 0001, desde el SQL Editor del Dashboard con el rol propietario --
-- nunca desde el cliente publico -- por lo que no requiere ni otorga
-- ningun GRANT nuevo. La respuesta oficial "A" NUNCA se incluye dentro
-- del objeto "contenido" (publico, legible por authenticated); vive
-- exclusivamente en ejercicios_respuestas (bloqueada para anon y
-- authenticated, solo legible por funciones SECURITY DEFINER como
-- registrar_intento()).
--
-- Por que "A" como respuesta oficial: coincide deliberadamente con
-- RESPUESTA_SINTETICA_DE_PRUEBA ('A') en scripts/lib/checkpoint5-logica.mjs
-- -- no es un requisito del esquema ni del script (registrar_intento()
-- acepta cualquier es_correcto boolean, true o false), es solo una
-- eleccion de coherencia para que el intento de prueba resulte en
-- es_correcto = true al leerlo.
--
-- Idempotencia SEGURA (revision posterior a la primera version de este
-- archivo): un "on conflict ... do nothing" simple en cada INSERT por
-- separado NO es suficiente por si solo. Si el UUID fijo ya existiera
-- en public.ejercicios con datos DISTINTOS (por ejemplo, otro ejercicio
-- que reutilizara este mismo id, o una edicion manual posterior), el
-- primer INSERT se omitiria en silencio (do nothing) pero el segundo
-- INSERT igual podria tener exito, asociando la respuesta oficial "A"
-- a un ejercicio ajeno y sin relacion real con "A" -- sin lanzar ningun
-- error. Por eso, ademas de "on conflict ... do nothing" (que sigue
-- evitando duplicados en el caso normal de reaplicar este mismo
-- archivo sin cambios), cada INSERT va seguido de una verificacion
-- explicita (bloques "do $$ ... $$") que confirma que la fila
-- resultante -- ya sea recien insertada o preexistente -- coincide
-- EXACTAMENTE con lo esperado. Si no coincide, se lanza una excepcion
-- y, gracias a la transaccion, TODA la migracion se revierte (no
-- queda ni el ejercicio ni la respuesta a medio insertar). Se eligio
-- deliberadamente NO usar "on conflict ... do update": sobrescribir
-- silenciosamente una fila existente distinta podria destruir un
-- ejercicio legitimo ya creado por otro proceso.
--
-- Transaccion: begin/commit envuelven los dos INSERT y sus dos
-- verificaciones. Cualquier "raise exception" revierte automaticamente
-- toda la transaccion (incluido cualquier INSERT que sí se hubiera
-- ejecutado antes de detectar la discrepancia) -- nunca queda un
-- ejercicio sin su respuesta asociada, ni una respuesta asociada a un
-- ejercicio incorrecto.
--
-- IMPORTANTE: este archivo NO ha sido ejecutado. No se ha contactado
-- Supabase para aplicarlo. Requiere autorizacion expresa posterior,
-- independiente de la que crea o corrige este archivo.
-- ================================================================

begin;

insert into public.ejercicios (id, materia, nivel_dificultad, contenido)
values (
  '00000000-0000-0000-0000-000000000001',
  'matematicas',
  1,
  jsonb_build_object(
    'tipo', 'opcion_multiple',
    'enunciado', '¿Cuánto es 2 + 3?',
    'opciones', jsonb_build_object(
      'A', '5',
      'B', '4',
      'C', '6',
      'D', '3'
    )
  )
)
on conflict (id) do nothing;

-- Verificacion tras el INSERT de ejercicios: la fila con el UUID fijo
-- debe existir (recien insertada, o preexistente por una aplicacion
-- anterior de esta misma migracion) y coincidir exactamente con los
-- valores esperados. Si el UUID ya estaba ocupado por un ejercicio
-- distinto, esto lo detecta y aborta antes de tocar
-- ejercicios_respuestas.
do $$
declare
  v_materia text;
  v_nivel_dificultad int;
  v_contenido jsonb;
  v_contenido_esperado jsonb := jsonb_build_object(
    'tipo', 'opcion_multiple',
    'enunciado', '¿Cuánto es 2 + 3?',
    'opciones', jsonb_build_object(
      'A', '5',
      'B', '4',
      'C', '6',
      'D', '3'
    )
  );
begin
  select materia, nivel_dificultad, contenido
    into v_materia, v_nivel_dificultad, v_contenido
    from public.ejercicios
   where id = '00000000-0000-0000-0000-000000000001';

  if not found then
    raise exception
      'Semilla checkpoint5: no se encontro la fila esperada en public.ejercicios (id=00000000-0000-0000-0000-000000000001) despues del INSERT.';
  end if;

  if v_materia is distinct from 'matematicas'
     or v_nivel_dificultad is distinct from 1
     or v_contenido is distinct from v_contenido_esperado then
    raise exception
      'Semilla checkpoint5: el UUID 00000000-0000-0000-0000-000000000001 ya existia en public.ejercicios con datos distintos a los esperados (materia=%, nivel_dificultad=%). Se aborta para no asociar la respuesta oficial "A" a un ejercicio ajeno.',
      v_materia, v_nivel_dificultad;
  end if;
end $$;

insert into public.ejercicios_respuestas (ejercicio_id, respuesta_correcta)
values (
  '00000000-0000-0000-0000-000000000001',
  'A'
)
on conflict (ejercicio_id) do nothing;

-- Verificacion tras el INSERT de ejercicios_respuestas: la respuesta
-- oficial asociada al UUID fijo debe ser exactamente "A". Si ya
-- existia una respuesta distinta (asociada, por ejemplo, al ejercicio
-- ajeno del caso anterior, o a cualquier otra discrepancia), esto lo
-- detecta y aborta -- gracias a la transaccion, tambien revierte el
-- INSERT de ejercicios si este llego a ejecutarse en esta misma
-- ejecucion.
do $$
declare
  v_respuesta text;
begin
  select respuesta_correcta
    into v_respuesta
    from public.ejercicios_respuestas
   where ejercicio_id = '00000000-0000-0000-0000-000000000001';

  if not found then
    raise exception
      'Semilla checkpoint5: no se encontro la fila esperada en public.ejercicios_respuestas (ejercicio_id=00000000-0000-0000-0000-000000000001) despues del INSERT.';
  end if;

  if v_respuesta is distinct from 'A' then
    raise exception
      'Semilla checkpoint5: la respuesta oficial existente para el ejercicio 00000000-0000-0000-0000-000000000001 es "%", distinta de la esperada "A". Se aborta.',
      v_respuesta;
  end if;
end $$;

commit;
