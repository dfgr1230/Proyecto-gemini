-- ================================================================
-- Dia 2 -- SQL base v5 (Parte A unicamente)
-- Archivo propuesto: supabase/migrations/0001_dia2_esquema_base.sql
-- ESTADO: PROPUESTA -- NO EJECUTAR SIN AUTORIZACION EXPRESA
--
-- Cambio respecto de v4 (unico cambio de esta version, alcance
-- deliberadamente acotado -- el resto de la arquitectura no se toco):
--
--   El CHECK de diagnosticos.respuestas en v4 solo exigia "objeto JSON
--   no vacio". Eso permitia que, como authenticated conserva INSERT
--   directo sobre diagnosticos (columnas usuario_id, respuestas), el
--   navegador insertara estructuras invalidas como {"x": true} o
--   {"cualquier_cosa": null} -- y como usuario_id es UNIQUE, ese
--   registro invalido ocupaba el unico diagnostico permitido para ese
--   usuario, bloqueando el flujo real.
--
--   Solucion elegida (la "opcion recomendada" mas pequena para el
--   MVP): se conserva el INSERT directo de authenticated tal cual
--   estaba, pero el CHECK se endurece con una funcion de validacion
--   dedicada, es_respuestas_diagnostico_valido(), que exige:
--     - respuestas debe ser un objeto JSON (no arreglo/escalar);
--     - entre 10 y 15 claves (segun CLAUDE.md: "test de 10-15
--       preguntas");
--     - ninguna clave vacia o solo espacios;
--     - ningun valor null, objeto ni arreglo (solo string, numero o
--       booleano);
--     - si el valor es string, no puede estar vacio ni ser solo
--       espacios.
--
--   Nota de diseno: fijar el rango "10 a 15" en la validacion
--   reintroduce la rigidez que en v4 se habia evitado a proposito
--   (una migracion nueva seria necesaria si el cuestionario cambia de
--   tamano). Se acepta ese costo aqui porque es exactamente lo que
--   cierra el hueco de integridad real que se detecto: sin un limite
--   de cantidad, un objeto de una sola clave falsa seguia siendo
--   "valido" para el CHECK anterior.
-- ================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------
-- FUNCION DE VALIDACION: es_respuestas_diagnostico_valido
--
-- Funcion pura (IMMUTABLE, SECURITY INVOKER -- no necesita privilegios
-- elevados: solo lee su propio parametro, no toca ninguna tabla). Se
-- usa exclusivamente dentro del CHECK de diagnosticos.respuestas.
-- authenticated necesita EXECUTE sobre ella porque el CHECK se evalua
-- con los privilegios de quien ejecuta el INSERT (ver GRANTS mas
-- abajo).
-- ----------------------------------------------------------------
create or replace function public.es_respuestas_diagnostico_valido(p_respuestas jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_count int := 0;
  v_key text;
  v_val jsonb;
begin
  if p_respuestas is null or jsonb_typeof(p_respuestas) <> 'object' then
    return false;
  end if;

  for v_key, v_val in
    select key, value from jsonb_each(p_respuestas)
  loop
    v_count := v_count + 1;

    if length(trim(v_key)) = 0 then
      return false;
    end if;

    if jsonb_typeof(v_val) in ('null', 'object', 'array') then
      return false;
    end if;

    if jsonb_typeof(v_val) = 'string' and length(trim(v_val #>> '{}')) = 0 then
      return false;
    end if;
  end loop;

  if v_count < 10 or v_count > 15 then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.es_respuestas_diagnostico_valido (jsonb) from public;
grant execute on function public.es_respuestas_diagnostico_valido (jsonb) to authenticated;

-- ----------------------------------------------------------------
-- TABLA: usuarios
-- ----------------------------------------------------------------
create table public.usuarios (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text not null check (char_length(trim(nombre)) > 0),
  email text not null unique,
  fecha_registro timestamptz not null default now()
);

-- NOTA (documentacion, no ejecutable): el cambio de email NO esta
-- habilitado en el MVP. public.usuarios.email se copia una sola vez
-- desde auth.users.email en el momento del registro (ver trigger
-- handle_new_user mas abajo) y no se vuelve a sincronizar despues.
-- Si en una etapa futura se habilita el flujo de cambio de correo de
-- Supabase Auth, sera necesario un mecanismo adicional (trigger sobre
-- auth.users o una funcion RPC) para mantener esta columna al dia;
-- hasta entonces queda registrado como riesgo conocido, no como una
-- funcion nueva sin uso todavia.

-- ----------------------------------------------------------------
-- TABLA: diagnosticos (1:1 con usuarios en el MVP)
--
-- Estructura esperada de "respuestas" (documentacion, y ahora TAMBIEN
-- forzada por es_respuestas_diagnostico_valido(), no solo documentada):
--   {
--     "p1": "B",
--     "p2": "A",
--     "p13": "texto corto si la pregunta lo requiere"
--   }
-- Cada clave es un identificador estable de pregunta (ej. "p1".."p15",
-- no vacia). Cada valor es la respuesta cruda para esa pregunta: debe
-- ser string, numero o booleano (nunca null, objeto ni arreglo); si es
-- string, no puede estar vacio. Debe haber entre 10 y 15 claves.
-- ----------------------------------------------------------------
create table public.diagnosticos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null unique references public.usuarios (id) on delete cascade,
  respuestas jsonb not null check (public.es_respuestas_diagnostico_valido(respuestas)),
  perfil_detectado jsonb,
  fecha timestamptz not null default now()
);

-- ----------------------------------------------------------------
-- TABLA: ejercicios (contenido publico, sin respuesta oficial)
-- ----------------------------------------------------------------
create table public.ejercicios (
  id uuid primary key default gen_random_uuid(),
  materia text not null check (materia in ('matematicas', 'lenguaje')),
  nivel_dificultad int not null check (nivel_dificultad between 1 and 5),
  contenido jsonb not null check (jsonb_typeof(contenido) = 'object')
);

create index idx_ejercicios_materia_nivel on public.ejercicios (materia, nivel_dificultad);

-- ----------------------------------------------------------------
-- TABLA: ejercicios_respuestas (respuesta oficial, aislada del cliente)
--
-- Convencion del MVP (documentacion, no impuesta como CHECK): las
-- actividades iniciales usan opciones cerradas con identificador
-- estable de una letra (A, B, C, D). No se fuerza un CHECK del tipo
-- "in ('A','B','C','D')" porque no todos los ejercicios futuros seran
-- de opcion cerrada. Cuando se necesite un ejercicio de texto libre,
-- la forma de distinguirlo NO requiere una columna nueva: se codifica
-- dentro de ejercicios.contenido, por ejemplo con una clave
-- contenido->>'tipo' = 'opcion_multiple' | 'texto_libre', que ya es
-- JSON flexible pensado para evolucionar sin migraciones nuevas.
-- ----------------------------------------------------------------
create table public.ejercicios_respuestas (
  ejercicio_id uuid primary key references public.ejercicios (id) on delete cascade,
  respuesta_correcta text not null check (char_length(trim(respuesta_correcta)) > 0)
);

-- ----------------------------------------------------------------
-- TABLA: intentos (INSERT solo permitido via funcion registrar_intento)
-- ----------------------------------------------------------------
create table public.intentos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  ejercicio_id uuid not null references public.ejercicios (id) on delete restrict,
  respuesta_dada text not null check (char_length(trim(respuesta_dada)) > 0),
  correcto boolean not null,
  tiempo_respuesta int check (
    tiempo_respuesta is null
    or (tiempo_respuesta >= 0 and tiempo_respuesta <= 3600)
  ),
  fecha timestamptz not null default now()
);

create index idx_intentos_usuario_id on public.intentos (usuario_id);
create index idx_intentos_ejercicio_id on public.intentos (ejercicio_id);

-- ----------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ----------------------------------------------------------------
alter table public.usuarios enable row level security;
alter table public.diagnosticos enable row level security;
alter table public.ejercicios enable row level security;
alter table public.ejercicios_respuestas enable row level security;
alter table public.intentos enable row level security;

create policy usuarios_select_propio
  on public.usuarios
  for select
  to authenticated
  using (auth.uid() = id);

create policy usuarios_update_propio
  on public.usuarios
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy diagnosticos_select_propio
  on public.diagnosticos
  for select
  to authenticated
  using (auth.uid() = usuario_id);

create policy diagnosticos_insert_propio
  on public.diagnosticos
  for insert
  to authenticated
  with check (auth.uid() = usuario_id);

create policy ejercicios_select_autenticados
  on public.ejercicios
  for select
  to authenticated
  using (true);

create policy intentos_select_propio
  on public.intentos
  for select
  to authenticated
  using (auth.uid() = usuario_id);

-- public.ejercicios_respuestas: RLS activo, sin ninguna policy definida.
-- Resultado: bloqueo total via API para anon y authenticated, sin
-- excepcion; solo funciones SECURITY DEFINER pueden leerla.

-- ----------------------------------------------------------------
-- GRANTS explicitos (defensa en profundidad ademas de RLS)
-- ----------------------------------------------------------------
revoke all on public.usuarios from anon, authenticated;
grant select on public.usuarios to authenticated;
grant update (nombre) on public.usuarios to authenticated;

revoke all on public.diagnosticos from anon, authenticated;
grant select on public.diagnosticos to authenticated;
grant insert (usuario_id, respuestas) on public.diagnosticos to authenticated;

revoke all on public.ejercicios from anon, authenticated;
grant select on public.ejercicios to authenticated;

revoke all on public.ejercicios_respuestas from anon, authenticated;

revoke all on public.intentos from anon, authenticated;
grant select on public.intentos to authenticated;

-- ----------------------------------------------------------------
-- TRIGGER: crear fila en usuarios al registrarse
--
-- Contrato obligatorio para el formulario de registro (Etapa C, aun
-- no implementada): la llamada a supabase.auth.signUp() debe incluir
-- el nombre dentro de options.data, exactamente asi:
--
--   supabase.auth.signUp({
--     email,
--     password,
--     options: { data: { nombre } }
--   })
--
-- Supabase Auth guarda ese objeto "options.data" tal cual dentro de
-- auth.users.raw_user_meta_data. El trigger de abajo lee exactamente
-- la clave "nombre" con raw_user_meta_data ->> 'nombre' -- el nombre
-- de la clave debe coincidir exacto (minusculas, sin acentos), igual
-- que el nombre de columna public.usuarios.nombre.
-- ----------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_nombre text;
begin
  if new.email is null then
    raise exception 'Registro rechazado: se requiere email (solo se admite registro con correo y contrasena)';
  end if;

  v_nombre := trim(coalesce(new.raw_user_meta_data ->> 'nombre', ''));

  if v_nombre = '' then
    raise exception 'Registro rechazado: falta "nombre" en options.data al llamar signUp()';
  end if;

  insert into public.usuarios (id, nombre, email)
  values (new.id, v_nombre, new.email);

  return new;
end;
$$;

revoke all on function public.handle_new_user () from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user ();

-- ----------------------------------------------------------------
-- RPC: registrar_intento (unica via permitida para insertar en intentos)
--
-- auth.uid() se usa siempre completamente calificado (esquema "auth"),
-- por lo que su resolucion NO depende de search_path -- sigue
-- funcionando igual con search_path = pg_catalog (sin "public").
--
-- Normalizacion: la comparacion es insensible a mayusculas/minusculas
-- y a espacios en ambos extremos, en ambos lados (respuesta enviada y
-- respuesta oficial). No se intenta resolver equivalencias de texto
-- libre ni numericas/decimales (ej. "3" vs "3.0" vs "tres") -- eso
-- queda fuera de alcance del MVP. El valor tal como lo escribio el
-- usuario (solo recortado de espacios, sin forzar mayusculas) es lo
-- que se guarda en intentos.respuesta_dada, para no alterar el
-- historial real de lo que el estudiante escribio.
-- ----------------------------------------------------------------
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

  insert into public.intentos (usuario_id, ejercicio_id, respuesta_dada, correcto, tiempo_respuesta)
  values (v_usuario_id, p_ejercicio_id, v_respuesta_dada, v_es_correcto, p_tiempo_respuesta)
  returning id, correcto, fecha into v_intento_id, v_es_correcto, v_fecha;

  return query select v_intento_id, v_es_correcto, v_fecha;
end;
$$;

revoke all on function public.registrar_intento (uuid, text, int) from public, anon;
grant execute on function public.registrar_intento (uuid, text, int) to authenticated;
