-- ================================================================
-- Dia 3 -- Ampliacion del banco de ejercicios de CINCO a DIEZ
-- Archivo: supabase/migrations/0007_dia3_ampliar_banco_a_diez.sql
--
-- MIGRACION EXCLUSIVAMENTE DE DATOS. No crea ni altera tablas, columnas,
-- CHECK, indices, funciones, policies ni GRANT. Mismo estilo y mismas
-- garantias que 0006, del que es continuacion directa.
--
-- ESTE ARCHIVO SE APLICA ENTERO O NO SE APLICA.
-- Todo va en una unica transaccion explicita: cada ejercicio y su
-- respuesta oficial son una pareja, y las verificaciones del final las
-- comprueban todas juntas. Cualquier discrepancia revierte el archivo
-- completo y no deja ni un ejercicio sin respuesta ni una respuesta
-- asociada a un ejercicio ajeno.
--
-- POR QUE HACE FALTA:
--   Tras 0002 y 0006 el banco tiene CINCO ejercicios, repartidos de forma
--   asimetrica: matematicas cubre los niveles 1, 2 y 3, pero lenguaje
--   solo llega al nivel 2. Cuando el analisis de Gemini recomienda
--   "lenguaje, nivel 3" no existe ninguna actividad que corresponda, y el
--   selector tiene que servir una aproximacion -- matematicas nivel 3 --
--   declarandolo honestamente en la interfaz. La recomendacion del modelo
--   se cumple a medias no por un fallo de la logica, sino porque falta el
--   contenido.
--
--   Estas cinco filas cierran ese hueco y dejan el banco simetrico:
--
--     materia      | nivel 1 | nivel 2 | nivel 3 | total
--     -------------|---------|---------|---------|------
--     matematicas  |    2    |    2    |    1    |   5
--     lenguaje     |    2    |    2    |    1    |   5
--
--   Con dos actividades por celda en los niveles 1 y 2, el ciclo puede
--   ademas repetir nivel sin repetir ejercicio, que es lo que ocurre
--   cuando Gemini decide MANTENER el nivel en vez de subirlo o bajarlo.
--
-- LO QUE ESTA MIGRACION NO CAMBIA, Y ES LO IMPORTANTE:
--   La ampliacion es UNICAMENTE de contenido. No se toca el selector, ni
--   el contrato del analisis, ni la logica adaptativa. Sigue siendo
--   Gemini quien decide materia, nivel y enfoque despues de cada
--   respuesta, y el selector quien busca en el banco la actividad que
--   mejor corresponda. NO se codifica ninguna alternancia ni ningun orden
--   fijo entre materias: no existe una secuencia "primero las cinco de
--   matematicas y despues las cinco de lenguaje", y nada en este archivo
--   la introduce.
--
-- HABILIDADES NUEVAS, NO REPETIDAS:
--   Ninguna de las cinco actividades reutiliza la habilidad de las cinco
--   existentes (suma de una cifra, suma con llevada, identificar un
--   sustantivo, identificar el verbo). Se anaden: resta de un paso,
--   problema contextual de dos pasos, comprension literal, funcion de un
--   conector adversativo e identificacion de una conclusion sustentada.
--
-- PROTECCION DE LA RESPUESTA OFICIAL: sin cambios respecto de 0002 y
-- 0006. public.ejercicios_respuestas sigue con RLS activo, sin ninguna
-- policy y con "revoke all ... from anon, authenticated". La respuesta
-- correcta NUNCA aparece dentro del objeto "contenido" (publico, legible
-- por authenticated); vive exclusivamente en ejercicios_respuestas,
-- accesible solo desde funciones SECURITY DEFINER como registrar_intento().
--
-- LAS RESPUESTAS CORRECTAS VARIAN (A, C, D, B, C), por el mismo motivo
-- que en 0006: con un banco pequeno y una respuesta oficial constante,
-- cualquiera que observase dos actividades podria acertar el resto sin
-- resolverlas, y las metricas de la prueba con usuarios reales dejarian
-- de significar nada.
--
-- CONTENIDO ORIGINAL: los dos textos breves de lenguaje estan escritos
-- para esta migracion. No se cita ninguna obra existente. No hay datos
-- personales, ni referencias clinicas, ni dependencias de imagenes,
-- audio o recursos externos.
-- ================================================================

begin;

-- ----------------------------------------------------------------
-- PRECONDICION: el banco remoto debe ser el previsto.
--
-- Se comprueban DOS cosas, y ninguna sobra:
--
--   1. Las cinco filas de 0002 y 0006 existen con su materia y nivel.
--      Si faltara alguna, la distribucion final de 2/2/1 no se
--      alcanzaria y este archivo estaria construyendo sobre un banco
--      que no conoce.
--
--   2. NO existe ningun ejercicio ajeno a los diez UUID que este
--      historial de migraciones ha creado. Un ejercicio sembrado por
--      otra via alteraria la distribucion sin que estas verificaciones
--      lo notaran, y el recuento final fallaria mas tarde con un mensaje
--      confuso. Es preferible detenerse aqui y decir exactamente que
--      sobra.
--
-- La comprobacion tolera A PROPOSITO exactamente dos estados: el banco
-- de cinco (antes de aplicar) y el de diez (ya aplicada). Cualquier otro
-- estado aborta de forma explicita. No se silencia nada.
-- ----------------------------------------------------------------
do $$
declare
  v_par record;
  v_materia text;
  v_nivel int;
  v_ajenos int;
begin
  for v_par in
    select *
      from (values
        ('00000000-0000-0000-0000-000000000001'::uuid, 'matematicas', 1),
        ('00000000-0000-0000-0000-000000000002'::uuid, 'matematicas', 2),
        ('00000000-0000-0000-0000-000000000003'::uuid, 'matematicas', 3),
        ('00000000-0000-0000-0000-000000000004'::uuid, 'lenguaje', 1),
        ('00000000-0000-0000-0000-000000000005'::uuid, 'lenguaje', 2)
      ) as previo (id, materia, nivel)
  loop
    select e.materia, e.nivel_dificultad
      into v_materia, v_nivel
      from public.ejercicios e
     where e.id = v_par.id;

    if not found then
      raise exception
        'Banco a diez: falta el ejercicio previo % (esperado %, nivel %). Aplica antes 0002 y 0006.',
        v_par.id, v_par.materia, v_par.nivel;
    end if;

    if v_materia is distinct from v_par.materia or v_nivel is distinct from v_par.nivel then
      raise exception
        'Banco a diez: el ejercicio previo % es (%, nivel %) y se esperaba (%, nivel %). Se aborta.',
        v_par.id, v_materia, v_nivel, v_par.materia, v_par.nivel;
    end if;
  end loop;

  select count(*)
    into v_ajenos
    from public.ejercicios e
   where e.id not in (
     '00000000-0000-0000-0000-000000000001'::uuid,
     '00000000-0000-0000-0000-000000000002'::uuid,
     '00000000-0000-0000-0000-000000000003'::uuid,
     '00000000-0000-0000-0000-000000000004'::uuid,
     '00000000-0000-0000-0000-000000000005'::uuid,
     '00000000-0000-0000-0000-000000000006'::uuid,
     '00000000-0000-0000-0000-000000000007'::uuid,
     '00000000-0000-0000-0000-000000000008'::uuid,
     '00000000-0000-0000-0000-000000000009'::uuid,
     '00000000-0000-0000-0000-00000000000a'::uuid
   );

  if v_ajenos > 0 then
    raise exception
      'Banco a diez: public.ejercicios contiene % ejercicio(s) ajeno(s) a este historial de migraciones. La distribucion final no seria la prevista. Se aborta.',
      v_ajenos;
  end if;
end $$;

-- ----------------------------------------------------------------
-- Los cinco ejercicios nuevos.
-- ----------------------------------------------------------------
insert into public.ejercicios (id, materia, nivel_dificultad, contenido) values
  (
    '00000000-0000-0000-0000-000000000006',
    'matematicas',
    1,
    jsonb_build_object(
      'tipo', 'opcion_multiple',
      'enunciado', 'Ana tenía 9 lápices y regaló 4. ¿Cuántos lápices le quedan?',
      'opciones', jsonb_build_object('A', '5', 'B', '6', 'C', '13', 'D', '4')
    )
  ),
  (
    '00000000-0000-0000-0000-000000000007',
    'matematicas',
    2,
    jsonb_build_object(
      'tipo', 'opcion_multiple',
      'enunciado', 'Un autobús lleva 15 pasajeros. En la primera parada suben 6 y en la segunda bajan 4. ¿Cuántos pasajeros lleva después de las dos paradas?',
      'opciones', jsonb_build_object('A', '21', 'B', '25', 'C', '17', 'D', '13')
    )
  ),
  (
    '00000000-0000-0000-0000-000000000008',
    'lenguaje',
    1,
    jsonb_build_object(
      'tipo', 'opcion_multiple',
      'enunciado', 'Lee el texto: «Marta guarda su bicicleta roja en el patio. Todas las mañanas la usa para ir a la escuela.» Según el texto, ¿dónde guarda Marta la bicicleta?',
      'opciones', jsonb_build_object('A', 'En la escuela', 'B', 'En la cocina', 'C', 'En la calle', 'D', 'En el patio')
    )
  ),
  (
    '00000000-0000-0000-0000-000000000009',
    'lenguaje',
    2,
    jsonb_build_object(
      'tipo', 'opcion_multiple',
      'enunciado', 'Lee la oración: «Quería salir a jugar, pero empezó a llover.» ¿Qué relación establece la palabra «pero» entre las dos ideas?',
      'opciones', jsonb_build_object('A', 'Añade una idea semejante', 'B', 'Presenta una oposición', 'C', 'Explica la causa', 'D', 'Indica una consecuencia')
    )
  ),
  (
    '00000000-0000-0000-0000-00000000000a',
    'lenguaje',
    3,
    jsonb_build_object(
      'tipo', 'opcion_multiple',
      'enunciado', 'Lee el texto: «En el colegio se instalaron tres bebederos nuevos. Durante el mes siguiente, muchos estudiantes los usaron para llenar botellas reutilizables. En ese mismo periodo, la cafetería vendió la mitad de botellas plásticas y en el patio aparecieron menos botellas desechadas.» ¿Cuál conclusión está respaldada por la información del texto?',
      'opciones', jsonb_build_object('A', 'Los estudiantes dejaron de tomar agua', 'B', 'La cafetería dejó de vender bebidas', 'C', 'El uso de los bebederos coincidió con una reducción en la compra y el desecho de botellas plásticas', 'D', 'El colegio prohibió las botellas de plástico')
    )
  )
on conflict (id) do nothing;

-- Verificacion de los ejercicios, con el mismo criterio de 0006 y por el
-- mismo motivo: "on conflict do nothing" por si solo NO basta. Si alguno
-- de estos UUID ya estuviera ocupado por otro ejercicio, el INSERT se
-- omitiria en silencio y la respuesta oficial de mas abajo quedaria
-- asociada a un ejercicio ajeno, sin lanzar ningun error.
--
-- Se compara el objeto "contenido" COMPLETO, no solo materia y nivel: dos
-- ejercicios distintos pueden compartir materia y nivel, asi que
-- comprobar solo esas dos columnas dejaria pasar precisamente el caso que
-- esta verificacion existe para detectar.
do $$
declare
  v_id uuid;
  v_materia text;
  v_nivel int;
  v_contenido jsonb;
  v_esperado jsonb;
  v_par record;
begin
  for v_par in
    select *
      from (values
        ('00000000-0000-0000-0000-000000000006'::uuid, 'matematicas', 1,
         jsonb_build_object(
           'tipo', 'opcion_multiple',
           'enunciado', 'Ana tenía 9 lápices y regaló 4. ¿Cuántos lápices le quedan?',
           'opciones', jsonb_build_object('A', '5', 'B', '6', 'C', '13', 'D', '4'))),
        ('00000000-0000-0000-0000-000000000007'::uuid, 'matematicas', 2,
         jsonb_build_object(
           'tipo', 'opcion_multiple',
           'enunciado', 'Un autobús lleva 15 pasajeros. En la primera parada suben 6 y en la segunda bajan 4. ¿Cuántos pasajeros lleva después de las dos paradas?',
           'opciones', jsonb_build_object('A', '21', 'B', '25', 'C', '17', 'D', '13'))),
        ('00000000-0000-0000-0000-000000000008'::uuid, 'lenguaje', 1,
         jsonb_build_object(
           'tipo', 'opcion_multiple',
           'enunciado', 'Lee el texto: «Marta guarda su bicicleta roja en el patio. Todas las mañanas la usa para ir a la escuela.» Según el texto, ¿dónde guarda Marta la bicicleta?',
           'opciones', jsonb_build_object('A', 'En la escuela', 'B', 'En la cocina', 'C', 'En la calle', 'D', 'En el patio'))),
        ('00000000-0000-0000-0000-000000000009'::uuid, 'lenguaje', 2,
         jsonb_build_object(
           'tipo', 'opcion_multiple',
           'enunciado', 'Lee la oración: «Quería salir a jugar, pero empezó a llover.» ¿Qué relación establece la palabra «pero» entre las dos ideas?',
           'opciones', jsonb_build_object('A', 'Añade una idea semejante', 'B', 'Presenta una oposición', 'C', 'Explica la causa', 'D', 'Indica una consecuencia'))),
        ('00000000-0000-0000-0000-00000000000a'::uuid, 'lenguaje', 3,
         jsonb_build_object(
           'tipo', 'opcion_multiple',
           'enunciado', 'Lee el texto: «En el colegio se instalaron tres bebederos nuevos. Durante el mes siguiente, muchos estudiantes los usaron para llenar botellas reutilizables. En ese mismo periodo, la cafetería vendió la mitad de botellas plásticas y en el patio aparecieron menos botellas desechadas.» ¿Cuál conclusión está respaldada por la información del texto?',
           'opciones', jsonb_build_object('A', 'Los estudiantes dejaron de tomar agua', 'B', 'La cafetería dejó de vender bebidas', 'C', 'El uso de los bebederos coincidió con una reducción en la compra y el desecho de botellas plásticas', 'D', 'El colegio prohibió las botellas de plástico')))
      ) as esperado (id, materia, nivel, contenido)
  loop
    v_id := v_par.id;
    v_esperado := v_par.contenido;

    select e.materia, e.nivel_dificultad, e.contenido
      into v_materia, v_nivel, v_contenido
      from public.ejercicios e
     where e.id = v_id;

    if not found then
      raise exception
        'Banco a diez: no se encontro el ejercicio % despues del INSERT.', v_id;
    end if;

    if v_materia is distinct from v_par.materia
       or v_nivel is distinct from v_par.nivel
       or v_contenido is distinct from v_esperado then
      raise exception
        'Banco a diez: el UUID % ya existia con datos distintos a los esperados (materia=%, nivel=%). Se aborta para no asociar una respuesta oficial a un ejercicio ajeno.',
        v_id, v_materia, v_nivel;
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------
-- Respuestas oficiales. Deliberadamente NO son todas la misma opcion.
-- ----------------------------------------------------------------
insert into public.ejercicios_respuestas (ejercicio_id, respuesta_correcta) values
  ('00000000-0000-0000-0000-000000000006', 'A'),
  ('00000000-0000-0000-0000-000000000007', 'C'),
  ('00000000-0000-0000-0000-000000000008', 'D'),
  ('00000000-0000-0000-0000-000000000009', 'B'),
  ('00000000-0000-0000-0000-00000000000a', 'C')
on conflict (ejercicio_id) do nothing;

-- Verificacion de las respuestas oficiales: si ya existia una distinta
-- (por ejemplo asociada al ejercicio ajeno del caso anterior), esto lo
-- detecta y, gracias a la transaccion, revierte tambien los INSERT de
-- ejercicios que si se hubieran ejecutado en esta misma pasada.
do $$
declare
  v_par record;
  v_respuesta text;
begin
  for v_par in
    select *
      from (values
        ('00000000-0000-0000-0000-000000000006'::uuid, 'A'),
        ('00000000-0000-0000-0000-000000000007'::uuid, 'C'),
        ('00000000-0000-0000-0000-000000000008'::uuid, 'D'),
        ('00000000-0000-0000-0000-000000000009'::uuid, 'B'),
        ('00000000-0000-0000-0000-00000000000a'::uuid, 'C')
      ) as esperado (id, respuesta)
  loop
    select r.respuesta_correcta
      into v_respuesta
      from public.ejercicios_respuestas r
     where r.ejercicio_id = v_par.id;

    if not found then
      raise exception
        'Banco a diez: no se encontro la respuesta oficial del ejercicio %.', v_par.id;
    end if;

    if v_respuesta is distinct from v_par.respuesta then
      raise exception
        'Banco a diez: la respuesta oficial del ejercicio % es "%", distinta de la esperada "%". Se aborta.',
        v_par.id, v_respuesta, v_par.respuesta;
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------
-- VERIFICACION FINAL DE LA DISTRIBUCION.
--
-- Es lo que convierte este archivo en una migracion comprobable y no en
-- una lista de INSERT con buena intencion. Si el banco resultante no es
-- exactamente el previsto, la transaccion entera se revierte y no queda
-- ninguna fila nueva.
-- ----------------------------------------------------------------
do $$
declare
  v_total int;
  v_matematicas int;
  v_lenguaje int;
  v_m1 int; v_m2 int; v_m3 int;
  v_l1 int; v_l2 int; v_l3 int;
  v_sin_respuesta int;
begin
  select count(*) into v_total from public.ejercicios;
  if v_total <> 10 then
    raise exception 'Banco a diez: el banco tiene % ejercicios y deberia tener 10.', v_total;
  end if;

  select
    count(*) filter (where materia = 'matematicas'),
    count(*) filter (where materia = 'lenguaje'),
    count(*) filter (where materia = 'matematicas' and nivel_dificultad = 1),
    count(*) filter (where materia = 'matematicas' and nivel_dificultad = 2),
    count(*) filter (where materia = 'matematicas' and nivel_dificultad = 3),
    count(*) filter (where materia = 'lenguaje'    and nivel_dificultad = 1),
    count(*) filter (where materia = 'lenguaje'    and nivel_dificultad = 2),
    count(*) filter (where materia = 'lenguaje'    and nivel_dificultad = 3)
    into v_matematicas, v_lenguaje, v_m1, v_m2, v_m3, v_l1, v_l2, v_l3
    from public.ejercicios;

  if v_matematicas <> 5 or v_lenguaje <> 5 then
    raise exception
      'Banco a diez: reparto por materia incorrecto (matematicas=%, lenguaje=%); se esperaba 5 y 5.',
      v_matematicas, v_lenguaje;
  end if;

  if v_m1 <> 2 or v_m2 <> 2 or v_m3 <> 1 then
    raise exception
      'Banco a diez: matematicas quedo %/%/% en los niveles 1/2/3; se esperaba 2/2/1.',
      v_m1, v_m2, v_m3;
  end if;

  if v_l1 <> 2 or v_l2 <> 2 or v_l3 <> 1 then
    raise exception
      'Banco a diez: lenguaje quedo %/%/% en los niveles 1/2/3; se esperaba 2/2/1.',
      v_l1, v_l2, v_l3;
  end if;

  -- Comprobacion explicita del hueco que esta migracion existe para
  -- cerrar: sin lenguaje nivel 3, una recomendacion de Gemini para esa
  -- casilla seguiria sin poder cumplirse de forma exacta.
  if v_l3 < 1 then
    raise exception 'Banco a diez: no existe ninguna actividad de lenguaje nivel 3.';
  end if;

  -- Cada ejercicio del banco debe tener su respuesta oficial. La clave
  -- primaria de ejercicios_respuestas ya impide que haya mas de una, asi
  -- que basta con comprobar que no falta ninguna.
  select count(*)
    into v_sin_respuesta
    from public.ejercicios e
    left join public.ejercicios_respuestas r on r.ejercicio_id = e.id
   where r.ejercicio_id is null;

  if v_sin_respuesta <> 0 then
    raise exception
      'Banco a diez: % ejercicio(s) sin respuesta oficial. Se aborta.', v_sin_respuesta;
  end if;
end $$;

commit;
