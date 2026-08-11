-- ================================================================
-- Dia 3 -- Ampliacion minima del banco de ejercicios
-- Archivo: supabase/migrations/0006_dia3_ampliar_banco.sql
--
-- Procede del borrador auditado docs/borrador-0006-dia3-ampliar-banco.sql.
-- Al promoverlo a migracion solo cambio ESTE bloque de cabecera: ninguna
-- sentencia SQL se modifico. La huella SHA-256 del cuerpo ejecutable
-- (todas las lineas que no son comentario ni linea vacia) es la misma
-- antes y despues del traslado:
--   9744A88043AA446BCEE07B638859876D9A5E7EF444E43DAC252C8237E2A5C432
--
-- ESTE ARCHIVO SE APLICA ENTERO O NO SE APLICA.
-- No se debe ejecutar una seleccion de filas: cada ejercicio y su
-- respuesta oficial son una pareja, y las verificaciones del final
-- comprueban las cuatro parejas juntas. Todo va en una unica transaccion
-- explicita; cualquier discrepancia revierte el archivo completo y no
-- deja ni un ejercicio sin su respuesta ni una respuesta asociada a un
-- ejercicio ajeno.
--
-- ORDEN RESPECTO DE 0005: son independientes. 0005 crea el almacen del
-- ciclo; este solo anade contenido pedagogico. Puede aplicarse antes o
-- despues, pero cada uno completo.
--
-- POR QUE HACE FALTA:
--   public.ejercicios contiene UNA sola fila: la semilla tecnica de 0002
--   (matematicas, nivel 1). Con un unico ejercicio, la segunda iteracion
--   del ciclo no tiene ninguna actividad pendiente que presentar, de modo
--   que la demostracion de extremo a extremo con DOS interacciones
--   consecutivas es imposible contra el proyecto remoto.
--
--   Estas cuatro filas son el minimo para que el ciclo pueda subir de
--   nivel, bajar de nivel y cambiar de materia.
--
-- PROTECCION DE LA RESPUESTA OFICIAL: sin cambios respecto de 0002.
-- public.ejercicios_respuestas sigue con RLS activo, sin ninguna policy y
-- con "revoke all ... from anon, authenticated". La respuesta correcta
-- NUNCA aparece dentro del objeto "contenido" (publico, legible por
-- authenticated); vive exclusivamente en ejercicios_respuestas, accesible
-- solo desde funciones SECURITY DEFINER como registrar_intento().
--
-- LAS RESPUESTAS CORRECTAS NO SON TODAS "A", a diferencia de la semilla
-- de 0002. Con un banco pequeno y una respuesta oficial constante,
-- cualquiera que observase dos actividades podria acertar el resto sin
-- resolverlas, y las metricas de la prueba con usuarios reales dejarian
-- de significar nada.
--
-- LO QUE ESTE ARCHIVO NO HACE:
--   - No modifica ninguna fila existente (incluida la semilla de 0002).
--   - No altera tablas, columnas, CHECK, policies ni GRANT.
--   - No crea funciones ni toca RLS.
-- ================================================================

begin;

insert into public.ejercicios (id, materia, nivel_dificultad, contenido) values
  (
    '00000000-0000-0000-0000-000000000002',
    'matematicas',
    2,
    jsonb_build_object(
      'tipo', 'opcion_multiple',
      'enunciado', '¿Cuánto es 14 + 8?',
      'opciones', jsonb_build_object('A', '21', 'B', '22', 'C', '23', 'D', '18')
    )
  ),
  (
    '00000000-0000-0000-0000-000000000003',
    'matematicas',
    3,
    jsonb_build_object(
      'tipo', 'opcion_multiple',
      'enunciado', '¿Cuánto es 47 + 26?',
      'opciones', jsonb_build_object('A', '63', 'B', '71', 'C', '73', 'D', '74')
    )
  ),
  (
    '00000000-0000-0000-0000-000000000004',
    'lenguaje',
    1,
    jsonb_build_object(
      'tipo', 'opcion_multiple',
      'enunciado', '¿Cuál de estas palabras es un sustantivo?',
      'opciones', jsonb_build_object('A', 'correr', 'B', 'rápido', 'C', 'muy', 'D', 'mesa')
    )
  ),
  (
    '00000000-0000-0000-0000-000000000005',
    'lenguaje',
    2,
    jsonb_build_object(
      'tipo', 'opcion_multiple',
      'enunciado', 'En la oración «El perro ladra fuerte», ¿cuál es el verbo?',
      'opciones', jsonb_build_object('A', 'el', 'B', 'ladra', 'C', 'perro', 'D', 'fuerte')
    )
  )
on conflict (id) do nothing;

-- Verificacion de los ejercicios, con el mismo criterio de 0002 y por el
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
        ('00000000-0000-0000-0000-000000000002'::uuid, 'matematicas', 2,
         jsonb_build_object(
           'tipo', 'opcion_multiple',
           'enunciado', '¿Cuánto es 14 + 8?',
           'opciones', jsonb_build_object('A', '21', 'B', '22', 'C', '23', 'D', '18'))),
        ('00000000-0000-0000-0000-000000000003'::uuid, 'matematicas', 3,
         jsonb_build_object(
           'tipo', 'opcion_multiple',
           'enunciado', '¿Cuánto es 47 + 26?',
           'opciones', jsonb_build_object('A', '63', 'B', '71', 'C', '73', 'D', '74'))),
        ('00000000-0000-0000-0000-000000000004'::uuid, 'lenguaje', 1,
         jsonb_build_object(
           'tipo', 'opcion_multiple',
           'enunciado', '¿Cuál de estas palabras es un sustantivo?',
           'opciones', jsonb_build_object('A', 'correr', 'B', 'rápido', 'C', 'muy', 'D', 'mesa'))),
        ('00000000-0000-0000-0000-000000000005'::uuid, 'lenguaje', 2,
         jsonb_build_object(
           'tipo', 'opcion_multiple',
           'enunciado', 'En la oración «El perro ladra fuerte», ¿cuál es el verbo?',
           'opciones', jsonb_build_object('A', 'el', 'B', 'ladra', 'C', 'perro', 'D', 'fuerte')))
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
        'Banco Dia 3: no se encontro el ejercicio % despues del INSERT.', v_id;
    end if;

    if v_materia is distinct from v_par.materia
       or v_nivel is distinct from v_par.nivel
       or v_contenido is distinct from v_esperado then
      raise exception
        'Banco Dia 3: el UUID % ya existia con datos distintos a los esperados (materia=%, nivel=%). Se aborta para no asociar una respuesta oficial a un ejercicio ajeno.',
        v_id, v_materia, v_nivel;
    end if;
  end loop;
end $$;

-- Respuestas oficiales. Deliberadamente NO son todas la misma opcion.
insert into public.ejercicios_respuestas (ejercicio_id, respuesta_correcta) values
  ('00000000-0000-0000-0000-000000000002', 'B'),
  ('00000000-0000-0000-0000-000000000003', 'C'),
  ('00000000-0000-0000-0000-000000000004', 'D'),
  ('00000000-0000-0000-0000-000000000005', 'B')
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
        ('00000000-0000-0000-0000-000000000002'::uuid, 'B'),
        ('00000000-0000-0000-0000-000000000003'::uuid, 'C'),
        ('00000000-0000-0000-0000-000000000004'::uuid, 'D'),
        ('00000000-0000-0000-0000-000000000005'::uuid, 'B')
      ) as esperado (id, respuesta)
  loop
    select r.respuesta_correcta
      into v_respuesta
      from public.ejercicios_respuestas r
     where r.ejercicio_id = v_par.id;

    if not found then
      raise exception
        'Banco Dia 3: no se encontro la respuesta oficial del ejercicio %.', v_par.id;
    end if;

    if v_respuesta is distinct from v_par.respuesta then
      raise exception
        'Banco Dia 3: la respuesta oficial del ejercicio % es "%", distinta de la esperada "%". Se aborta.',
        v_par.id, v_respuesta, v_par.respuesta;
    end if;
  end loop;
end $$;

commit;
