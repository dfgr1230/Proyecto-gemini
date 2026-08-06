// Logica pura (sin red, sin stdin, sin process.exit) del Checkpoint 5:
// clasificadores, constructores de carga y la orquestacion completa de los
// cuatro controles autorizados, todo con DEPENDENCIAS INYECTADAS -- esto es
// lo que permite probar el flujo completo con dobles locales, sin contactar
// Supabase, siguiendo el mismo patron ya usado en src/lib/auth/contrato.ts
// (ejecutarLogin/ejecutarRegistro reciben sus llamadas de red como
// parametros). scripts/checkpoint5-intentos.mjs es el UNICO archivo que
// importa este modulo y que efectivamente toca red/stdin/https.
//
// Contrato real confirmado leyendo supabase/migrations/0001_dia2_esquema_base.sql
// (no asumido, no inventado):
//
//   - public.ejercicios: RLS activa, policy "ejercicios_select_autenticados"
//     (for select, to authenticated, using (true)); GRANT select a
//     authenticated. Columnas visibles: id, materia, nivel_dificultad,
//     contenido. NUNCA incluye la respuesta correcta -- por diseno, elegir
//     cualquier fila de esta tabla no puede revelarla.
//
//   - public.ejercicios_respuestas: RLS activa SIN ninguna policy definida,
//     y ademas "revoke all on public.ejercicios_respuestas from anon,
//     authenticated" (sin GRANT select alguno, ni siquiera para
//     authenticated). Esto significa que el rechazo esperado en una
//     ejecucion real es a nivel de PRIVILEGIO DE TABLA (codigo Postgres
//     42501, mensaje generico "permission denied for table..."), NO
//     necesariamente un mensaje que mencione explicitamente "row-level
//     security" o "policy" (a diferencia del 42501 de
//     scripts/checkpoint4-diagnosticos.mjs, que si proviene de una policy
//     real). Por eso las funciones de este archivo NUNCA etiquetan ese
//     rechazo como "bloqueo RLS" especificamente: solo como "acceso
//     denegado" -- la evidencia real es "permiso denegado", la causa exacta
//     (falta de GRANT, RLS, o ambas) no siempre es distinguible desde el
//     mensaje, y no se afirma mas de lo que la evidencia permite.
//
//   - public.registrar_intento(p_ejercicio_id uuid, p_respuesta_dada text,
//     p_tiempo_respuesta int default null) returns table (intento_id uuid,
//     es_correcto boolean, fecha timestamptz). SECURITY DEFINER. GRANT
//     execute SOLO a "authenticated" ("revoke all ... from public, anon").
//     Ningun parametro publico permite imponer "correcto": la firma real
//     (leida del SQL, no asumida) no lo acepta, y el codigo de este archivo
//     ni siquiera construye una carga con esa clave.
//
//   - public.intentos: RLS con policy "intentos_select_propio" (for select,
//     to authenticated, using (auth.uid() = usuario_id)); GRANT select a
//     authenticated unicamente (anon no tiene ningun privilegio sobre esta
//     tabla, ni siquiera de lectura).
//
//   - Sin restriccion UNIQUE sobre intentos.usuario_id (a diferencia de
//     diagnosticos): un usuario puede tener varios intentos. Por eso las
//     verificaciones de integridad de este archivo comparan conjuntos
//     "antes/despues" en vez de asumir un conteo absoluto fijo -- una
//     ejecucion futura repetida no invalidaria la logica de deteccion.
//
// EVIDENCIA DEL CONTROL 3 (calculo de "correcto" en el servidor) -- tres
// piezas de naturaleza DISTINTA. Es importante no confundirlas entre si:
//
//   1. ESTATICA, YA CONFIRMADA (cita directa del SQL real, no inferencia):
//      el cuerpo de registrar_intento() literalmente hace
//      "select er.respuesta_correcta into v_respuesta_oficial from
//      ejercicios_respuestas ..." y luego
//      "v_es_correcto := (lower(trim(v_respuesta_dada)) =
//      lower(trim(v_respuesta_oficial)))" -- el servidor SI consulta y
//      compara contra la respuesta protegida, dentro del propio codigo
//      que se ejecutara en produccion. Ademas, el valor devuelto proviene
//      del mismo "returning ... correcto ... into v_es_correcto" del
//      INSERT, asi que por construccion el valor devuelto es EXACTAMENTE
//      el persistido -- no hay ninguna ruta en el codigo real donde
//      pudieran divergir. Esto es evidencia directa del codigo existente,
//      verificable hoy sin ejecutar nada.
//
//   2. ESTATICA, YA CONFIRMADA (firma real): los unicos 3 parametros de
//      entrada son p_ejercicio_id, p_respuesta_dada, p_tiempo_respuesta.
//      Ninguna variante de "correcto" existe en la firma.
//
//   3. COMPORTAMENTAL PREVISTA, TODAVIA NO EJECUTADA CONTRA SUPABASE: el
//      diseno de construirCargaConParametroManipulado / clasificarRechazoParametroManipulado
//      / registrarIntentoManipulado (mas abajo) esta pensado para que, en
//      una FUTURA ejecucion real contra Supabase, PostgREST rechace una
//      carga con una clave ajena a la firma real (ver la constante
//      CODIGO_POSTGREST_FUNCION_NO_ENCONTRADA y su justificacion). En
//      ESTE turno, esa logica de clasificacion fue validada UNICAMENTE
//      mediante dobles locales (node --test, sin red) -- no se ha
//      confirmado todavia con una respuesta real de PostgREST. No se
//      afirma que esta pieza ya constituya "evidencia comportamental
//      real": es comportamiento previsto, pendiente de una ejecucion real
//      futura y unica (compatible con "una sola creacion deliberada de
//      intento", ya que se espera que esta llamada NUNCA cree fila
//      alguna).
//
// LIMITE QUE SIGUE DOCUMENTADO (deliberadamente fuera de alcance): las
// piezas 1 y 2 demuestran el MECANISMO (el calculo ocurre en el servidor,
// el cliente no puede controlarlo, lo devuelto coincide con lo
// persistido). NO demuestran la correccion SEMANTICA del calculo para un
// ejercicio concreto (si "A" es realmente la respuesta correcta de ESE
// ejercicio) -- verificar eso exigiria leer ejercicios_respuestas, que
// esta deliberadamente fuera de alcance. El contrato del Checkpoint 5
// (ver informe de implementacion) exige probar el MECANISMO, no la
// correccion semantica de un caso particular.

// Verifica que ambas variables publicas requeridas esten presentes y no
// vacias -- SIN leer ni exponer sus valores (el llamador decide que hacer
// con el resultado booleano). Extraida como funcion pura para que el caso
// "configuracion completa" (ademas del caso "falta una variable") sea
// verificable con node --test, sin ejecutar el script real ni su
// mecanismo interactivo de credenciales.
export function configuracionPublicaCompleta(url, key) {
  return Boolean(url) && Boolean(key);
}

// ----------------------------------------------------------------
// Clasificadores basicos (identicos en espiritu a los usados en
// scripts/checkpoint4-diagnosticos.mjs y src/lib/auth/contrato.ts, mas no
// importados de alli -- cada checkpoint es un archivo hermano
// independiente, siguiendo la convencion ya establecida en este proyecto).
// ----------------------------------------------------------------

// SQLSTATE de Postgres: 5 caracteres alfanumericos en mayuscula.
export function pareceCodigoPostgres(code) {
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code);
}

export function esErrorDeRed(error) {
  const e = error || {};
  const mensaje = (e.message || '').toLowerCase();
  return e.name === 'AuthRetryableFetchError' || mensaje.includes('fetch failed') || e.status === 0;
}

export function esErrorDeAutenticacion(error) {
  const e = error || {};
  const mensaje = (e.message || '').toLowerCase();
  return (
    mensaje.includes('jwt') ||
    mensaje.includes('not authenticated') ||
    mensaje.includes('no autenticado') ||
    e.status === 401
  );
}

export function maskEmail(email) {
  if (!email || !email.includes('@')) return '(no disponible)';
  const [local, domain] = email.split('@');
  const visible = local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(local.length - visible.length, 3))}@${domain}`;
}

export function shortId(id) {
  if (!id) return '(no disponible)';
  return `${String(id).slice(0, 8)}...`;
}

// ----------------------------------------------------------------
// CONTROL 1 -- lectura directa de ejercicios_respuestas por Usuario A.
//
// Distingue explicitamente los cuatro desenlaces posibles:
//   - fallo_critico: hubo filas y ningun error -> fuga real de la
//     respuesta protegida. Nunca se etiqueta esto como aceptable.
//   - inconcluso_sin_error: sin error y sin filas. NO se asume bloqueo (la
//     tabla podria simplemente no tener filas para ese ejercicio, o
//     cualquier otra razon); se exige un error explicito para afirmar
//     "acceso denegado".
//   - rechazo_esperado: error con codigo 42501 (permiso denegado a nivel
//     de tabla y/o RLS -- ver nota de contrato mas arriba).
//   - error_no_atribuible: cualquier otro error (red, autenticacion,
//     transporte) que no permite atribuir el rechazo a un control de
//     seguridad real.
// ----------------------------------------------------------------
export function clasificarLecturaProtegida({ data, error }) {
  if (!error) {
    if (Array.isArray(data) && data.length > 0) return 'fallo_critico';
    return 'inconcluso_sin_error';
  }
  if (error.code === '42501') return 'rechazo_esperado';
  return 'error_no_atribuible';
}

// ----------------------------------------------------------------
// Precondicion: al menos un ejercicio existente, elegible SIN conocer su
// respuesta correcta (la consulta que la produce jamas toca
// ejercicios_respuestas -- ver seleccionarEjerciciosDisponibles en
// scripts/checkpoint5-intentos.mjs).
// ----------------------------------------------------------------
export function clasificarPrecondicionEjercicio({ data, error }) {
  if (error) return 'error_tecnico';
  if (!Array.isArray(data) || data.length === 0) return 'precondicion_incumplida';
  return 'exito';
}

// Deterministico (nunca aleatorio): la primera fila del orden estable ya
// pedido explicitamente en la consulta, para que la evidencia de una
// ejecucion futura sea reproducible.
export function elegirEjercicioDePrueba(filas) {
  return filas[0];
}

// ----------------------------------------------------------------
// CONTROL 2 -- registro valido mediante registrar_intento().
//
// Valores sinteticos, deterministas, sin relacion con la respuesta real
// (que el script nunca conoce): sirven solo para demostrar que la RPC
// acepta un intento bien formado para el propio usuario.
// ----------------------------------------------------------------
const RESPUESTA_SINTETICA_DE_PRUEBA = 'A';
const TIEMPO_RESPUESTA_SINTETICO_SEGUNDOS = 5;

export function construirCargaRegistrarIntento(
  ejercicioId,
  respuestaDada = RESPUESTA_SINTETICA_DE_PRUEBA,
  tiempoRespuesta = TIEMPO_RESPUESTA_SINTETICO_SEGUNDOS
) {
  return {
    p_ejercicio_id: ejercicioId,
    p_respuesta_dada: respuestaDada,
    p_tiempo_respuesta: tiempoRespuesta,
  };
}

// Comprobacion explicita de que el cliente JAMAS intenta imponer
// "correcto": ninguna variante de esa clave debe aparecer en la carga
// real enviada a la RPC.
export function tieneParametroCorrectoControlablePorCliente(carga) {
  return ['correcto', 'es_correcto', 'p_correcto'].some((clave) =>
    Object.prototype.hasOwnProperty.call(carga, clave)
  );
}

export function clasificarRegistroValido({ data, error }) {
  if (error) {
    if (pareceCodigoPostgres(error.code)) return 'fallo';
    return 'error_tecnico';
  }
  if (!Array.isArray(data) || data.length !== 1) return 'fallo';
  const fila = data[0];
  if (!fila || !fila.intento_id || typeof fila.es_correcto !== 'boolean' || !fila.fecha) return 'fallo';
  return 'exito';
}

// Confirma, dentro de las filas propias devueltas por RLS
// (intentos_select_propio), que el intento recien creado esta presente y
// pertenece al usuario autenticado.
export function verificarPropiedadIntento({ data, error }, intentoIdEsperado, idPropietarioEsperado) {
  if (error) return 'error_tecnico';
  if (!Array.isArray(data)) return 'error_tecnico';
  const fila = data.find((f) => f.id === intentoIdEsperado);
  if (!fila) return 'fallo';
  if (fila.usuario_id !== idPropietarioEsperado) return 'fallo';
  return 'exito';
}

// ----------------------------------------------------------------
// CONTROL 3 -- calculo de "correcto" en el servidor, sin parametro
// publico controlable. Ver evidencia y limite documentados al inicio del
// archivo.
// ----------------------------------------------------------------

// Carga deliberadamente manipulada: identica a una carga real, mas una
// clave ajena a la firma real de registrar_intento(). Se espera que
// PostgREST rechace la llamada COMPLETA por no encontrar una sobrecarga
// compatible -- nunca se espera que la funcion la ejecute ni que se cree
// fila alguna.
export function construirCargaConParametroManipulado(ejercicioId) {
  return {
    ...construirCargaRegistrarIntento(ejercicioId),
    correcto: true,
  };
}

// Codigo REAL y documentado de PostgREST para "no se encontro ninguna
// funcion compatible con los parametros nombrados enviados" -- exactamente
// el caso de una carga con una clave ajena a la firma real de
// registrar_intento(). Confirmado leyendo el codigo fuente ya instalado en
// este proyecto (no supuesto, no memorizado de documentacion externa):
//   - node_modules/@supabase/postgrest-js/src/PostgrestBuilder.ts (~linea
//     322): comentario del propio SDK sobre un bug de React Native que
//     "caus[a] PGRST202 on parameter-less RPC calls" -- confirma que
//     PGRST202 es el codigo real para esta clase de fallo de resolucion
//     de funcion.
//   - node_modules/@supabase/postgrest-js/src/PostgrestError.ts: el campo
//     "code" se documenta explicitamente como el identificador ESTABLE a
//     usar ("stable error code from PostgREST (e.g. PGRST301) or Postgres
//     (e.g. 42501). Branch on this rather than on message text"), y vive
//     en un espacio de nombres ("PGRST*") DISTINTO de los SQLSTATE de
//     Postgres (5 caracteres alfanumericos como "42501", "23505") usados
//     en el resto de este archivo y en scripts/checkpoint4-diagnosticos.mjs.
const CODIGO_POSTGREST_FUNCION_NO_ENCONTRADA = 'PGRST202';

// Clasifica el intento de invocar registrar_intento() con una clave ajena
// a su firma real. Exige atribucion INEQUIVOCA a una incompatibilidad de
// firma -- nunca aprueba un error de autenticacion, autorizacion (RLS o
// ausencia de GRANT), red, esquema inaccesible, u otra causa ajena.
//
// Campos examinados y por que:
//   - error.code: se compara EXACTAMENTE contra CODIGO_POSTGREST_FUNCION_NO_ENCONTRADA
//     ('PGRST202'). Es el criterio PRINCIPAL y suficiente por si solo --
//     ningun SQLSTATE de Postgres (42501, 23505, etc.) ni ningun otro
//     codigo PGRST se acepta como equivalente.
//   - error.message: NUNCA es la unica base de la clasificacion; el
//     codigo ya es suficiente. El mensaje no se examina en absoluto aqui
//     (a diferencia de esErrorDeAutenticacion, que si lo usa para OTROS
//     controles donde no existe un codigo estructurado aplicable).
//   - error.details / error.hint: NUNCA se leen ni se imprimen en ningun
//     punto de este archivo (pueden incluir valores internos).
//
// Un error de red/transporte (sin codigo de PostgREST fiable) se clasifica
// aparte como error_tecnico. Cualquier otro error (autenticacion,
// autorizacion, SQLSTATE de Postgres, esquema inaccesible, o cualquier
// causa no atribuible de forma inequivoca a la incompatibilidad de firma)
// se clasifica como error_no_atribuible -- nunca se aprueba por descarte.
export function clasificarRechazoParametroManipulado({ data, error }) {
  if (!error) {
    if (Array.isArray(data) && data.length > 0) return 'fallo_critico';
    return 'inconcluso_sin_error';
  }
  if (esErrorDeRed(error)) return 'error_tecnico';
  if (error.code === CODIGO_POSTGREST_FUNCION_NO_ENCONTRADA) return 'rechazo_esperado';
  return 'error_no_atribuible';
}

// Combina las tres piezas de evidencia (ver comentario de cabecera):
// ausencia de la clave en la carga real, rechazo real de la carga
// manipulada, y exito del Control 2 (sin el cual no hay un intento
// legitimo con el que comparar). Un fallo_critico de cualquiera de las
// dos primeras domina sobre el resto.
export function clasificarCalculoServidor({ cargaEnviada, resultadoControl2, resultadoRechazoParametroManipulado }) {
  if (tieneParametroCorrectoControlablePorCliente(cargaEnviada) || resultadoRechazoParametroManipulado === 'fallo_critico') {
    return 'fallo_critico';
  }
  if (resultadoControl2 !== 'exito') return 'no_ejecutado';
  if (resultadoRechazoParametroManipulado === 'rechazo_esperado') return 'exito';
  return resultadoRechazoParametroManipulado; // error_tecnico o inconcluso_sin_error, propagado tal cual
}

// ----------------------------------------------------------------
// CONTROL 4 -- rechazo de registrar_intento() sin autenticacion.
//
// LIMITE DOCUMENTADO de verificarIntegridadTrasRechazo (mas abajo): esa
// funcion compara el conjunto de intentos PROPIOS de Usuario A antes y
// despues del intento anonimo -- es la unica vista posible para el
// cliente publico, porque la policy "intentos_select_propio" (RLS) y el
// GRANT select (solo a "authenticated") impiden ver la tabla completa o
// las filas de otros usuarios. Por si sola, esa comparacion NO podria
// descartar que el intento anonimo hubiera creado una fila para OTRO
// usuario_id (invisible para Usuario A).
//
// Ese hueco se cierra con evidencia ESTATICA independiente (cita directa
// del SQL, no inferencia): registrar_intento() no acepta ningun parametro
// de usuario_id -- usa exclusivamente "v_usuario_id uuid := auth.uid()"
// como valor a insertar, y hace "raise exception 'No autenticado'" ANTES
// de cualquier insert si auth.uid() es null. Es decir: el UNICO
// usuario_id posible para cualquier fila creada por esta RPC es el del
// llamante autenticado, y una llamada sin sesion nunca llega a insertar
// nada, para NINGUN usuario_id. La comparacion antes/despues de Usuario A
// es entonces evidencia suficiente PARA ESTA FUNCION EN PARTICULAR, no
// una comprobacion generica de "nadie inserto nada en toda la tabla".
// ----------------------------------------------------------------
export function clasificarRechazoSinAuth({ data, error }) {
  if (!error) {
    if (Array.isArray(data) && data.length > 0) return 'fallo_critico';
    return 'inconcluso_sin_error';
  }
  if (error.code === '42501') return 'rechazo_esperado';
  if (esErrorDeAutenticacion(error)) return 'rechazo_esperado';
  if (pareceCodigoPostgres(error.code)) return 'error_no_atribuible';
  return 'error_tecnico';
}

// Compara conjuntos de ids "antes" y "despues" del intento anonimo, en vez
// de asumir un conteo absoluto fijo -- intentos NO tiene restriccion
// UNIQUE por usuario, asi que una ejecucion futura repetida no deberia
// invalidar esta deteccion (a diferencia de si se comparara contra "0" o
// "1" de forma absoluta).
export function verificarIntegridadTrasRechazo(respuestaAntes, respuestaDespues) {
  if (respuestaAntes?.error || respuestaDespues?.error) return 'error_tecnico';
  if (!Array.isArray(respuestaAntes?.data) || !Array.isArray(respuestaDespues?.data)) return 'error_tecnico';
  if (respuestaDespues.data.length !== respuestaAntes.data.length) return 'fallo_critico';
  const idsAntes = new Set(respuestaAntes.data.map((f) => f.id));
  const hayIdNuevo = respuestaDespues.data.some((f) => !idsAntes.has(f.id));
  if (hayIdNuevo) return 'fallo_critico';
  return 'exito';
}

export function combinarResultadoControl4(resultadoRpcAnonimo, resultadoIntegridadPosterior) {
  if (resultadoRpcAnonimo === 'fallo_critico' || resultadoIntegridadPosterior === 'fallo_critico') {
    return 'fallo_critico';
  }
  if (resultadoRpcAnonimo === 'rechazo_esperado' && resultadoIntegridadPosterior === 'exito') {
    return 'rechazo_esperado';
  }
  if (resultadoRpcAnonimo === 'error_tecnico' || resultadoIntegridadPosterior === 'error_tecnico') {
    return 'error_tecnico';
  }
  return 'no_ejecutado';
}

// ----------------------------------------------------------------
// Resultado global.
// ----------------------------------------------------------------
export function marcaResultado(v) {
  if (v === 'exito' || v === 'rechazo_esperado') return '✅';
  if (v === 'fallo' || v === 'fallo_critico') return '❌';
  return '⚠️'; // error_tecnico, no_ejecutado, precondicion_incumplida, inconcluso_sin_error, error_no_atribuible
}

const VALORES_INCONCLUSOS = [
  'error_tecnico',
  'no_ejecutado',
  'precondicion_incumplida',
  'inconcluso_sin_error',
  'error_no_atribuible',
];

export function calcularResultadoGlobal(resultados) {
  const valores = Object.values(resultados);
  const hayFallo = valores.some((v) => v === 'fallo' || v === 'fallo_critico');
  const hayInconcluso = valores.some((v) => VALORES_INCONCLUSOS.includes(v));
  if (hayFallo) return 'NO APROBADO';
  if (hayInconcluso) return 'INCONCLUSO';
  return 'APROBADO';
}

// ----------------------------------------------------------------
// Orquestacion completa, con TODAS las dependencias de red inyectadas.
// Ninguna funcion de este archivo llama a Supabase, https, readline ni
// process.exit -- eso vive exclusivamente en
// scripts/checkpoint5-intentos.mjs, que wirea estas mismas dependencias
// con el cliente real.
//
// "detenido" solo se activa ante condiciones realmente inseguras o que
// impiden continuar con sentido (fallo_critico de fuga, o precondicion
// incumplida) -- un "fallo" ordinario (ej. un INSERT valido rechazado por
// error tecnico) NO detiene el resto de los controles, igual que en
// scripts/checkpoint4-diagnosticos.mjs.
// ----------------------------------------------------------------
export async function ejecutarCheckpoint5(dependencias) {
  const {
    iniciarSesionA,
    cerrarSesion,
    seleccionarEjerciciosRespuestas,
    seleccionarEjerciciosDisponibles,
    registrarIntento,
    registrarIntentoManipulado,
    seleccionarIntentosPropios,
    registrarIntentoAnonimo,
  } = dependencias;

  const resultados = {
    lecturaProtegidaRechazada: 'no_ejecutado',
    precondicionEjercicioDisponible: 'no_ejecutado',
    registroValidoAceptado: 'no_ejecutado',
    propiedadIntentoConfirmada: 'no_ejecutado',
    calculoServidorSinParametroCliente: 'no_ejecutado',
    rechazoSinAutenticacion: 'no_ejecutado',
    sesionesCerradas: 'exito',
  };

  let idA = null;
  let detenido = false;
  let huboSignOutFallido = false;
  let ejercicioElegido = null;
  let intentoIdCreado = null;
  let snapshotAntes = null;

  try {
    idA = await iniciarSesionA();
    if (!idA) {
      resultados.lecturaProtegidaRechazada = 'error_tecnico';
      detenido = true;
    }

    if (!detenido) {
      const respuestaLectura = await seleccionarEjerciciosRespuestas();
      resultados.lecturaProtegidaRechazada = clasificarLecturaProtegida(respuestaLectura);
      if (resultados.lecturaProtegidaRechazada === 'fallo_critico') {
        detenido = true;
      }
    }

    if (!detenido) {
      const respuestaEjercicios = await seleccionarEjerciciosDisponibles();
      resultados.precondicionEjercicioDisponible = clasificarPrecondicionEjercicio(respuestaEjercicios);
      if (resultados.precondicionEjercicioDisponible !== 'exito') {
        detenido = true;
      } else {
        ejercicioElegido = elegirEjercicioDePrueba(respuestaEjercicios.data);
      }
    }

    if (!detenido) {
      const cargaControl2 = construirCargaRegistrarIntento(ejercicioElegido.id);
      const respuestaRegistro = await registrarIntento(cargaControl2);
      resultados.registroValidoAceptado = clasificarRegistroValido(respuestaRegistro);
      if (resultados.registroValidoAceptado === 'exito') {
        intentoIdCreado = respuestaRegistro.data[0].intento_id;
      }

      // Intento diseniado para producir, en una ejecucion real futura,
      // rechazo de PostgREST por incompatibilidad de firma (clave ajena
      // "correcto"), con cero mutaciones esperadas -- ver evidencia y
      // limites documentados al inicio del archivo. En este turno esta
      // logica solo fue validada mediante dobles locales (node --test),
      // no contra Supabase real.
      const cargaManipulada = construirCargaConParametroManipulado(ejercicioElegido.id);
      const respuestaManipulada = await registrarIntentoManipulado(cargaManipulada);
      const resultadoRechazoParametroManipulado = clasificarRechazoParametroManipulado(respuestaManipulada);

      resultados.calculoServidorSinParametroCliente = clasificarCalculoServidor({
        cargaEnviada: cargaControl2,
        resultadoControl2: resultados.registroValidoAceptado,
        resultadoRechazoParametroManipulado,
      });

      if (resultados.calculoServidorSinParametroCliente === 'fallo_critico') {
        detenido = true;
      }

      snapshotAntes = await seleccionarIntentosPropios();
      if (intentoIdCreado) {
        resultados.propiedadIntentoConfirmada = verificarPropiedadIntento(snapshotAntes, intentoIdCreado, idA);
      }
    }
  } finally {
    if (!(await cerrarSesion())) huboSignOutFallido = true;
  }

  if (!detenido && ejercicioElegido) {
    const cargaControl4 = construirCargaRegistrarIntento(ejercicioElegido.id);
    const respuestaAnonima = await registrarIntentoAnonimo(cargaControl4);
    const resultadoRpcAnonimo = clasificarRechazoSinAuth(respuestaAnonima);

    let resultadoIntegridad = 'no_ejecutado';
    try {
      const idA2 = await iniciarSesionA();
      if (idA2) {
        const snapshotDespues = await seleccionarIntentosPropios();
        resultadoIntegridad = verificarIntegridadTrasRechazo(snapshotAntes, snapshotDespues);
      } else {
        resultadoIntegridad = 'error_tecnico';
      }
    } finally {
      if (!(await cerrarSesion())) huboSignOutFallido = true;
    }

    resultados.rechazoSinAutenticacion = combinarResultadoControl4(resultadoRpcAnonimo, resultadoIntegridad);
  }

  resultados.sesionesCerradas = huboSignOutFallido ? 'error_tecnico' : 'exito';

  return resultados;
}
