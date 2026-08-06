// Pruebas locales del Checkpoint 5. SIN RED, SIN Supabase real: usan
// node:test + node:assert (nativos de Node) y dependencias inyectadas
// (dobles locales) para toda la logica de scripts/lib/checkpoint5-logica.mjs.
//
// IMPORTANTE: este archivo NUNCA importa scripts/checkpoint5-intentos.mjs
// (el script ejecutable real, que llama a main() de forma incondicional al
// final del archivo -- importarlo dispararia readline/https/Supabase real).
// Todo lo que se sabe sobre ese archivo aqui se verifica leyendo su codigo
// fuente como texto (misma tecnica ya usada en
// src/lib/auth/contrato.test.mjs para los componentes de React).
//
// Ejecutar con: node --test scripts/checkpoint5-intentos.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  configuracionPublicaCompleta,
  pareceCodigoPostgres,
  esErrorDeRed,
  esErrorDeAutenticacion,
  maskEmail,
  shortId,
  clasificarLecturaProtegida,
  clasificarPrecondicionEjercicio,
  elegirEjercicioDePrueba,
  construirCargaRegistrarIntento,
  tieneParametroCorrectoControlablePorCliente,
  clasificarRegistroValido,
  verificarPropiedadIntento,
  construirCargaConParametroManipulado,
  clasificarRechazoParametroManipulado,
  clasificarCalculoServidor,
  clasificarRechazoSinAuth,
  verificarIntegridadTrasRechazo,
  combinarResultadoControl4,
  marcaResultado,
  calcularResultadoGlobal,
  ejecutarCheckpoint5,
} from './lib/checkpoint5-logica.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');
const RUTA_SCRIPT = path.join(RAIZ, 'scripts/checkpoint5-intentos.mjs');

// ============================================================
// Configuracion publica (caso 1: configuracion completa; caso 2: variable
// requerida ausente). Ambos casos verificados de forma aislada y
// dedicada, sin necesidad de ejecutar el script real.
// ============================================================

test('configuracionPublicaCompleta: URL y clave presentes -> true (configuracion publica completa)', () => {
  assert.equal(configuracionPublicaCompleta('https://proyecto.supabase.invalid', 'clave-publica-ficticia'), true);
});

test('configuracionPublicaCompleta: falta la URL -> false (variable requerida ausente)', () => {
  assert.equal(configuracionPublicaCompleta(undefined, 'clave-publica-ficticia'), false);
});

test('configuracionPublicaCompleta: falta la clave -> false (variable requerida ausente)', () => {
  assert.equal(configuracionPublicaCompleta('https://proyecto.supabase.invalid', undefined), false);
});

test('configuracionPublicaCompleta: cadena vacia se trata como ausente', () => {
  assert.equal(configuracionPublicaCompleta('', ''), false);
});

// ============================================================
// Clasificadores basicos.
// ============================================================

test('pareceCodigoPostgres: reconoce SQLSTATE valido y rechaza formatos ajenos', () => {
  assert.equal(pareceCodigoPostgres('42501'), true);
  assert.equal(pareceCodigoPostgres('23505'), true);
  assert.equal(pareceCodigoPostgres('AuthRetryableFetchError'), false);
  assert.equal(pareceCodigoPostgres(undefined), false);
  assert.equal(pareceCodigoPostgres(''), false);
});

test('esErrorDeRed: distingue fallo de transporte de un error de negocio', () => {
  assert.equal(esErrorDeRed({ name: 'AuthRetryableFetchError', message: 'fetch failed', status: 0 }), true);
  assert.equal(esErrorDeRed({ message: 'fetch failed' }), true);
  assert.equal(esErrorDeRed({ status: 0 }), true);
  assert.equal(esErrorDeRed({ code: '42501', message: 'permission denied' }), false);
});

test('esErrorDeAutenticacion: reconoce mensajes/estado de falta de sesion', () => {
  assert.equal(esErrorDeAutenticacion({ message: 'JWT expired' }), true);
  assert.equal(esErrorDeAutenticacion({ message: 'No autenticado' }), true);
  assert.equal(esErrorDeAutenticacion({ status: 401 }), true);
  assert.equal(esErrorDeAutenticacion({ code: '42501', message: 'permission denied for function' }), false);
});

test('maskEmail: nunca expone el correo completo', () => {
  const enmascarado = maskEmail('usuario-temporal@example.invalid');
  assert.ok(!enmascarado.includes('usuario-temporal'));
  assert.ok(enmascarado.endsWith('@example.invalid'));
  assert.equal(maskEmail(undefined), '(no disponible)');
});

test('shortId: trunca a 8 caracteres y nunca devuelve el UUID completo', () => {
  const idFicticio = 'e8ce1250-aaaa-bbbb-cccc-000000000000';
  const truncado = shortId(idFicticio);
  assert.equal(truncado, 'e8ce1250...');
  assert.ok(!truncado.includes(idFicticio));
  assert.equal(shortId(undefined), '(no disponible)');
});

// ============================================================
// CONTROL 1 -- lectura directa de ejercicios_respuestas.
// ============================================================

test('clasificarLecturaProtegida: filas devueltas sin error -> fallo_critico (fuga real)', () => {
  const resultado = clasificarLecturaProtegida({ data: [{ ejercicio_id: 'x', respuesta_correcta: 'A' }], error: null });
  assert.equal(resultado, 'fallo_critico');
});

test('clasificarLecturaProtegida: sin error y sin filas -> inconcluso_sin_error (nunca se asume bloqueo sin evidencia)', () => {
  const resultado = clasificarLecturaProtegida({ data: [], error: null });
  assert.equal(resultado, 'inconcluso_sin_error');
});

test('clasificarLecturaProtegida: error 42501 -> rechazo_esperado', () => {
  const resultado = clasificarLecturaProtegida({ data: null, error: { code: '42501', message: 'permission denied for table ejercicios_respuestas' } });
  assert.equal(resultado, 'rechazo_esperado');
});

test('clasificarLecturaProtegida: error de red -> error_no_atribuible (no se confunde con un control de seguridad)', () => {
  const resultado = clasificarLecturaProtegida({ data: null, error: { name: 'AuthRetryableFetchError', message: 'fetch failed', status: 0 } });
  assert.equal(resultado, 'error_no_atribuible');
});

// ============================================================
// Precondicion de ejercicio.
// ============================================================

test('clasificarPrecondicionEjercicio: sin ejercicios disponibles -> precondicion_incumplida', () => {
  assert.equal(clasificarPrecondicionEjercicio({ data: [], error: null }), 'precondicion_incumplida');
});

test('clasificarPrecondicionEjercicio: al menos un ejercicio -> exito', () => {
  assert.equal(clasificarPrecondicionEjercicio({ data: [{ id: 'e1', materia: 'matematicas', nivel_dificultad: 1 }], error: null }), 'exito');
});

test('clasificarPrecondicionEjercicio: error -> error_tecnico', () => {
  assert.equal(clasificarPrecondicionEjercicio({ data: null, error: { message: 'fetch failed', status: 0 } }), 'error_tecnico');
});

test('elegirEjercicioDePrueba: elige la primera fila del orden ya pedido, nunca al azar', () => {
  const filas = [{ id: 'primero' }, { id: 'segundo' }];
  assert.deepEqual(elegirEjercicioDePrueba(filas), { id: 'primero' });
});

// ============================================================
// CONTROL 2 -- registro valido mediante registrar_intento().
// ============================================================

test('construirCargaRegistrarIntento: forma exacta esperada por la RPC real (3 parametros, sin "correcto")', () => {
  const carga = construirCargaRegistrarIntento('ejercicio-ficticio-1');
  assert.deepEqual(Object.keys(carga).sort(), ['p_ejercicio_id', 'p_respuesta_dada', 'p_tiempo_respuesta']);
  assert.equal(carga.p_ejercicio_id, 'ejercicio-ficticio-1');
  assert.ok(!('correcto' in carga));
  assert.ok(!('es_correcto' in carga));
});

test('construirCargaRegistrarIntento: acepta respuesta y tiempo personalizados', () => {
  const carga = construirCargaRegistrarIntento('e1', 'B', 12);
  assert.equal(carga.p_respuesta_dada, 'B');
  assert.equal(carga.p_tiempo_respuesta, 12);
});

test('tieneParametroCorrectoControlablePorCliente: la carga real nunca lo tiene', () => {
  const carga = construirCargaRegistrarIntento('e1');
  assert.equal(tieneParametroCorrectoControlablePorCliente(carga), false);
});

test('tieneParametroCorrectoControlablePorCliente: detecta cualquier variante manipulada de "correcto"', () => {
  assert.equal(tieneParametroCorrectoControlablePorCliente({ p_ejercicio_id: 'e1', correcto: true }), true);
  assert.equal(tieneParametroCorrectoControlablePorCliente({ p_ejercicio_id: 'e1', es_correcto: true }), true);
  assert.equal(tieneParametroCorrectoControlablePorCliente({ p_ejercicio_id: 'e1', p_correcto: true }), true);
});

test('clasificarRegistroValido: respuesta bien formada de la RPC -> exito', () => {
  const resultado = clasificarRegistroValido({
    data: [{ intento_id: 'i1', es_correcto: false, fecha: '2026-01-01T00:00:00Z' }],
    error: null,
  });
  assert.equal(resultado, 'exito');
});

test('clasificarRegistroValido: error con codigo Postgres -> fallo (rechazo inesperado de un intento valido)', () => {
  const resultado = clasificarRegistroValido({ data: null, error: { code: '23514', message: 'check violation' } });
  assert.equal(resultado, 'fallo');
});

test('clasificarRegistroValido: error de red/transporte -> error_tecnico, no "fallo"', () => {
  const resultado = clasificarRegistroValido({ data: null, error: { name: 'AuthRetryableFetchError', message: 'fetch failed', status: 0 } });
  assert.equal(resultado, 'error_tecnico');
});

test('clasificarRegistroValido: forma de fila incompleta (sin es_correcto booleano) -> fallo', () => {
  const resultado = clasificarRegistroValido({ data: [{ intento_id: 'i1', es_correcto: 'si', fecha: 'x' }], error: null });
  assert.equal(resultado, 'fallo');
});

test('clasificarRegistroValido: mas o menos de una fila -> fallo', () => {
  assert.equal(clasificarRegistroValido({ data: [], error: null }), 'fallo');
  assert.equal(
    clasificarRegistroValido({
      data: [
        { intento_id: 'i1', es_correcto: true, fecha: 'x' },
        { intento_id: 'i2', es_correcto: false, fecha: 'y' },
      ],
      error: null,
    }),
    'fallo'
  );
});

test('verificarPropiedadIntento: fila propia encontrada y con el usuario correcto -> exito', () => {
  const resultado = verificarPropiedadIntento({ data: [{ id: 'i1', usuario_id: 'userA' }], error: null }, 'i1', 'userA');
  assert.equal(resultado, 'exito');
});

test('verificarPropiedadIntento: la fila pertenece a otro usuario -> fallo', () => {
  const resultado = verificarPropiedadIntento({ data: [{ id: 'i1', usuario_id: 'userB' }], error: null }, 'i1', 'userA');
  assert.equal(resultado, 'fallo');
});

test('verificarPropiedadIntento: el id esperado no aparece entre las filas propias -> fallo', () => {
  const resultado = verificarPropiedadIntento({ data: [{ id: 'otro', usuario_id: 'userA' }], error: null }, 'i1', 'userA');
  assert.equal(resultado, 'fallo');
});

// ============================================================
// CONTROL 3 -- calculo de "correcto" en el servidor.
//
// Piezas de naturaleza distinta, NUNCA presentadas aqui como equivalentes:
//   - ESTATICA, ya confirmada: la carga real nunca contiene "correcto".
//   - COMPORTAMENTAL PREVISTA, validada en este turno UNICAMENTE con
//     dobles locales (no contra Supabase real): se espera que PostgREST
//     rechace una carga con "correcto" con el codigo real y documentado
//     PGRST202 ("funcion no encontrada en la cache de esquema" -- ver
//     justificacion completa en scripts/lib/checkpoint5-logica.mjs, con
//     cita del codigo fuente de @supabase/postgrest-js ya instalado).
// ============================================================

test('construirCargaConParametroManipulado: agrega "correcto" a una carga real por lo demas identica', () => {
  const carga = construirCargaConParametroManipulado('ejercicio-1');
  assert.equal(carga.p_ejercicio_id, 'ejercicio-1');
  assert.equal(carga.correcto, true);
  assert.ok(tieneParametroCorrectoControlablePorCliente(carga));
});

test('clasificarRechazoParametroManipulado: codigo PGRST202 (funcion no encontrada) -> rechazo_esperado', () => {
  const resultado = clasificarRechazoParametroManipulado({
    data: null,
    error: { code: 'PGRST202', message: 'Could not find the function public.registrar_intento(...) in the schema cache' },
  });
  assert.equal(resultado, 'rechazo_esperado');
});

test('clasificarRechazoParametroManipulado: la llamada manipulada tiene exito (fuga real) -> fallo_critico', () => {
  const resultado = clasificarRechazoParametroManipulado({
    data: [{ intento_id: 'x', es_correcto: true, fecha: 'y' }],
    error: null,
  });
  assert.equal(resultado, 'fallo_critico');
});

test('clasificarRechazoParametroManipulado: sin error y sin datos -> inconcluso_sin_error', () => {
  assert.equal(clasificarRechazoParametroManipulado({ data: [], error: null }), 'inconcluso_sin_error');
});

test('clasificarRechazoParametroManipulado: error de red -> error_tecnico, no atribuible al rechazo real', () => {
  const resultado = clasificarRechazoParametroManipulado({
    data: null,
    error: { name: 'AuthRetryableFetchError', message: 'fetch failed', status: 0 },
  });
  assert.equal(resultado, 'error_tecnico');
});

test('clasificarRechazoParametroManipulado: un error de autorizacion/RLS (42501) NUNCA se aprueba como rechazo por incompatibilidad de firma', () => {
  const resultado = clasificarRechazoParametroManipulado({
    data: null,
    error: { code: '42501', message: 'permission denied for function registrar_intento' },
  });
  assert.equal(resultado, 'error_no_atribuible');
});

test('clasificarRechazoParametroManipulado: un error de autenticacion (JWT/401) NUNCA se aprueba como rechazo por incompatibilidad de firma', () => {
  const resultado = clasificarRechazoParametroManipulado({
    data: null,
    error: { message: 'JWT expired', status: 401 },
  });
  assert.equal(resultado, 'error_no_atribuible');
});

test('clasificarRechazoParametroManipulado: otro SQLSTATE de Postgres (ej. 23514) NUNCA se aprueba, aunque sea un codigo estructurado', () => {
  const resultado = clasificarRechazoParametroManipulado({
    data: null,
    error: { code: '23514', message: 'check violation' },
  });
  assert.equal(resultado, 'error_no_atribuible');
});

test('clasificarRechazoParametroManipulado: otro codigo PGRST distinto de PGRST202 tampoco se aprueba', () => {
  const resultado = clasificarRechazoParametroManipulado({
    data: null,
    error: { code: 'PGRST301', message: 'JWT invalid' },
  });
  assert.equal(resultado, 'error_no_atribuible');
});

test('clasificarRechazoParametroManipulado: no depende del texto del mensaje -- un mensaje que MENCIONA "schema cache" sin el codigo correcto NO se aprueba', () => {
  const resultado = clasificarRechazoParametroManipulado({
    data: null,
    error: { code: '42501', message: 'Something unrelated mentions schema cache but is not PGRST202' },
  });
  assert.equal(resultado, 'error_no_atribuible');
});

test('clasificarRechazoParametroManipulado: nunca examina ni depende de error.details/error.hint', () => {
  // Un error con "details"/"hint" sospechosos pero sin el codigo correcto
  // sigue sin aprobarse -- confirma que esos campos no influyen en la
  // clasificacion (y, por diseno, tampoco se leen ni se imprimen).
  const resultado = clasificarRechazoParametroManipulado({
    data: null,
    error: { code: '42501', message: 'permission denied', details: 'PGRST202 mentioned here', hint: 'PGRST202 also here' },
  });
  assert.equal(resultado, 'error_no_atribuible');
});

test('clasificarCalculoServidor: carga propia manipulada -> fallo_critico, sin importar el resto', () => {
  const cargaManipulada = { p_ejercicio_id: 'e1', p_respuesta_dada: 'A', correcto: true };
  assert.equal(
    clasificarCalculoServidor({ cargaEnviada: cargaManipulada, resultadoControl2: 'exito', resultadoRechazoParametroManipulado: 'rechazo_esperado' }),
    'fallo_critico'
  );
});

test('clasificarCalculoServidor: el intento REAL de inyeccion tuvo exito (fuga) -> fallo_critico, incluso con carga propia limpia', () => {
  const cargaLimpia = construirCargaRegistrarIntento('e1');
  assert.equal(
    clasificarCalculoServidor({ cargaEnviada: cargaLimpia, resultadoControl2: 'exito', resultadoRechazoParametroManipulado: 'fallo_critico' }),
    'fallo_critico'
  );
});

test('clasificarCalculoServidor: Control 2 no exitoso -> no_ejecutado, sin importar el resultado de la inyeccion', () => {
  const cargaLimpia = construirCargaRegistrarIntento('e1');
  assert.equal(
    clasificarCalculoServidor({ cargaEnviada: cargaLimpia, resultadoControl2: 'fallo', resultadoRechazoParametroManipulado: 'rechazo_esperado' }),
    'no_ejecutado'
  );
});

test('clasificarCalculoServidor: todo correcto (carga limpia, Control 2 exitoso, inyeccion rechazada) -> exito', () => {
  const cargaLimpia = construirCargaRegistrarIntento('e1');
  assert.equal(
    clasificarCalculoServidor({ cargaEnviada: cargaLimpia, resultadoControl2: 'exito', resultadoRechazoParametroManipulado: 'rechazo_esperado' }),
    'exito'
  );
});

test('clasificarCalculoServidor: un error tecnico en el intento de inyeccion se propaga como inconcluso, no como exito', () => {
  const cargaLimpia = construirCargaRegistrarIntento('e1');
  assert.equal(
    clasificarCalculoServidor({ cargaEnviada: cargaLimpia, resultadoControl2: 'exito', resultadoRechazoParametroManipulado: 'error_tecnico' }),
    'error_tecnico'
  );
});

// ============================================================
// CONTROL 4 -- rechazo sin autenticacion.
// ============================================================

test('clasificarRechazoSinAuth: se devolvio una fila sin error -> fallo_critico (intento anonimo aceptado)', () => {
  assert.equal(clasificarRechazoSinAuth({ data: [{ intento_id: 'x' }], error: null }), 'fallo_critico');
});

test('clasificarRechazoSinAuth: sin error y sin datos -> inconcluso_sin_error', () => {
  assert.equal(clasificarRechazoSinAuth({ data: [], error: null }), 'inconcluso_sin_error');
});

test('clasificarRechazoSinAuth: error 42501 -> rechazo_esperado', () => {
  assert.equal(clasificarRechazoSinAuth({ data: null, error: { code: '42501', message: 'permission denied for function registrar_intento' } }), 'rechazo_esperado');
});

test('clasificarRechazoSinAuth: mensaje de autenticacion sin codigo Postgres -> rechazo_esperado', () => {
  assert.equal(clasificarRechazoSinAuth({ data: null, error: { message: 'No autenticado' } }), 'rechazo_esperado');
});

test('clasificarRechazoSinAuth: codigo Postgres ajeno (ej. ejercicio inexistente) -> error_no_atribuible, nunca aprobado por autenticacion', () => {
  const resultado = clasificarRechazoSinAuth({ data: null, error: { code: 'P0001', message: 'Ejercicio no encontrado: e1' } });
  assert.equal(resultado, 'error_no_atribuible');
});

test('clasificarRechazoSinAuth: error de red -> error_tecnico, nunca interpretado como rechazo por autenticacion', () => {
  const resultado = clasificarRechazoSinAuth({ data: null, error: { name: 'AuthRetryableFetchError', message: 'fetch failed', status: 0 } });
  assert.equal(resultado, 'error_tecnico');
});

test('verificarIntegridadTrasRechazo: mismo conjunto de ids antes y despues -> exito', () => {
  const antes = { data: [{ id: 'i1' }], error: null };
  const despues = { data: [{ id: 'i1' }], error: null };
  assert.equal(verificarIntegridadTrasRechazo(antes, despues), 'exito');
});

test('verificarIntegridadTrasRechazo: aparece un id nuevo -> fallo_critico (el intento anonimo si se creo)', () => {
  const antes = { data: [{ id: 'i1' }], error: null };
  const despues = { data: [{ id: 'i1' }, { id: 'i2-anonimo' }], error: null };
  assert.equal(verificarIntegridadTrasRechazo(antes, despues), 'fallo_critico');
});

test('verificarIntegridadTrasRechazo: cambia la cantidad total -> fallo_critico', () => {
  const antes = { data: [], error: null };
  const despues = { data: [{ id: 'nuevo' }], error: null };
  assert.equal(verificarIntegridadTrasRechazo(antes, despues), 'fallo_critico');
});

test('verificarIntegridadTrasRechazo: es robusto ante ejecuciones previas (no asume un conteo absoluto fijo)', () => {
  // Simula que ya existian 3 intentos de una ejecucion anterior -- el
  // criterio de exito es "el conjunto no cambio", no "hay exactamente 1".
  const antes = { data: [{ id: 'viejo1' }, { id: 'viejo2' }, { id: 'viejo3' }], error: null };
  const despues = { data: [{ id: 'viejo1' }, { id: 'viejo2' }, { id: 'viejo3' }], error: null };
  assert.equal(verificarIntegridadTrasRechazo(antes, despues), 'exito');
});

test('combinarResultadoControl4: rechazo esperado + integridad confirmada -> rechazo_esperado', () => {
  assert.equal(combinarResultadoControl4('rechazo_esperado', 'exito'), 'rechazo_esperado');
});

test('combinarResultadoControl4: cualquier fallo_critico domina sobre el resto', () => {
  assert.equal(combinarResultadoControl4('fallo_critico', 'exito'), 'fallo_critico');
  assert.equal(combinarResultadoControl4('rechazo_esperado', 'fallo_critico'), 'fallo_critico');
});

test('combinarResultadoControl4: error tecnico en cualquiera de los dos -> error_tecnico', () => {
  assert.equal(combinarResultadoControl4('error_tecnico', 'exito'), 'error_tecnico');
  assert.equal(combinarResultadoControl4('rechazo_esperado', 'error_tecnico'), 'error_tecnico');
});

// ============================================================
// Resultado global.
// ============================================================

test('marcaResultado: mapea exito/rechazo_esperado a la marca de aprobado', () => {
  assert.equal(marcaResultado('exito'), '✅');
  assert.equal(marcaResultado('rechazo_esperado'), '✅');
});

test('marcaResultado: mapea fallo/fallo_critico a la marca de fallo', () => {
  assert.equal(marcaResultado('fallo'), '❌');
  assert.equal(marcaResultado('fallo_critico'), '❌');
});

test('marcaResultado: cualquier otro valor (inconcluso) usa la marca de advertencia', () => {
  assert.equal(marcaResultado('error_tecnico'), '⚠️');
  assert.equal(marcaResultado('no_ejecutado'), '⚠️');
});

test('calcularResultadoGlobal: todo exito/rechazo_esperado -> APROBADO', () => {
  const resultados = {
    a: 'exito',
    b: 'rechazo_esperado',
    c: 'exito',
  };
  assert.equal(calcularResultadoGlobal(resultados), 'APROBADO');
});

test('calcularResultadoGlobal: cualquier fallo -> NO APROBADO, incluso con otros campos inconclusos', () => {
  const resultados = {
    a: 'exito',
    b: 'fallo',
    c: 'no_ejecutado',
  };
  assert.equal(calcularResultadoGlobal(resultados), 'NO APROBADO');
});

test('calcularResultadoGlobal: sin fallos pero con algo inconcluso -> INCONCLUSO', () => {
  const resultados = {
    a: 'exito',
    b: 'no_ejecutado',
  };
  assert.equal(calcularResultadoGlobal(resultados), 'INCONCLUSO');
});

// ============================================================
// ejecutarCheckpoint5: flujo completo con dependencias inyectadas.
// Ninguna de estas pruebas contacta red real -- todos los dobles son
// funciones locales definidas en este mismo archivo.
// ============================================================

function crearDependenciasFelices() {
  const llamadas = {
    iniciarSesionA: 0,
    cerrarSesion: 0,
    seleccionarEjerciciosRespuestas: 0,
    seleccionarEjerciciosDisponibles: 0,
    registrarIntento: 0,
    registrarIntentoManipulado: 0,
    seleccionarIntentosPropios: 0,
    registrarIntentoAnonimo: 0,
  };

  let seCerroSesion = false;

  const dependencias = {
    iniciarSesionA: async () => {
      llamadas.iniciarSesionA += 1;
      seCerroSesion = false;
      return 'usuarioA-id';
    },
    cerrarSesion: async () => {
      llamadas.cerrarSesion += 1;
      seCerroSesion = true;
      return true;
    },
    seleccionarEjerciciosRespuestas: async () => {
      llamadas.seleccionarEjerciciosRespuestas += 1;
      return { data: [], error: { code: '42501', message: 'permission denied for table ejercicios_respuestas' } };
    },
    seleccionarEjerciciosDisponibles: async () => {
      llamadas.seleccionarEjerciciosDisponibles += 1;
      return { data: [{ id: 'ejercicio-1', materia: 'matematicas', nivel_dificultad: 1 }], error: null };
    },
    registrarIntento: async () => {
      llamadas.registrarIntento += 1;
      return { data: [{ intento_id: 'intento-1', es_correcto: false, fecha: '2026-01-01T00:00:00Z' }], error: null };
    },
    registrarIntentoManipulado: async () => {
      llamadas.registrarIntentoManipulado += 1;
      return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.registrar_intento(...) in the schema cache' } };
    },
    seleccionarIntentosPropios: async () => {
      llamadas.seleccionarIntentosPropios += 1;
      return { data: [{ id: 'intento-1', usuario_id: 'usuarioA-id' }], error: null };
    },
    registrarIntentoAnonimo: async () => {
      llamadas.registrarIntentoAnonimo += 1;
      return { data: null, error: { code: '42501', message: 'permission denied for function registrar_intento' } };
    },
  };

  return { dependencias, llamadas, seCerroSesion: () => seCerroSesion };
}

// ============================================================
// Pruebas dedicadas e independientes (una sola preocupacion por prueba,
// sin reutilizar el test "flujo feliz" agrupado como cobertura de estos
// requisitos especificos).
// ============================================================

test('ejecutarCheckpoint5: si falta una dependencia inyectada, falla explicitamente (TypeError) en vez de recurrir a una ruta de red real no sustituida', async () => {
  const { dependencias } = crearDependenciasFelices();
  delete dependencias.iniciarSesionA;
  await assert.rejects(() => ejecutarCheckpoint5(dependencias), TypeError);
});

test('ejecutarCheckpoint5: login correcto permite que el flujo continue al Control 1 (dedicada, no agrupada)', async () => {
  const { dependencias, llamadas } = crearDependenciasFelices();
  await ejecutarCheckpoint5(dependencias);
  assert.ok(llamadas.iniciarSesionA >= 1, 'debe haberse intentado iniciar sesion');
  assert.equal(llamadas.seleccionarEjerciciosRespuestas, 1, 'un login correcto debe permitir que el Control 1 se ejecute');
});

test('ejecutarCheckpoint5: login rechazado impide que se ejecute cualquier control posterior (dedicada, no agrupada)', async () => {
  const { dependencias, llamadas } = crearDependenciasFelices();
  dependencias.iniciarSesionA = async () => {
    llamadas.iniciarSesionA += 1;
    return null;
  };
  const resultados = await ejecutarCheckpoint5(dependencias);
  assert.equal(llamadas.seleccionarEjerciciosRespuestas, 0, 'un login rechazado no debe permitir que el Control 1 se ejecute');
  assert.equal(resultados.lecturaProtegidaRechazada, 'error_tecnico');
});

test('ejecutarCheckpoint5: cierre de sesion exitoso se refleja en sesionesCerradas (dedicada, no agrupada)', async () => {
  const { dependencias, llamadas } = crearDependenciasFelices();
  const resultados = await ejecutarCheckpoint5(dependencias);
  assert.equal(llamadas.cerrarSesion, 2, 'debe intentar cerrar sesion en ambas fases autenticadas');
  assert.equal(resultados.sesionesCerradas, 'exito');
});

test('ejecutarCheckpoint5: un control que nunca llega a ejecutarse queda exactamente como "no_ejecutado" (equivalente a NO EJECUTADO en el informe; dedicada, no agrupada)', async () => {
  const { dependencias } = crearDependenciasFelices();
  dependencias.iniciarSesionA = async () => null;
  const resultados = await ejecutarCheckpoint5(dependencias);
  assert.equal(resultados.precondicionEjercicioDisponible, 'no_ejecutado');
  assert.equal(resultados.registroValidoAceptado, 'no_ejecutado');
  assert.equal(resultados.propiedadIntentoConfirmada, 'no_ejecutado');
  assert.equal(resultados.calculoServidorSinParametroCliente, 'no_ejecutado');
  assert.equal(resultados.rechazoSinAutenticacion, 'no_ejecutado');
});

test('ejecutarCheckpoint5: flujo feliz completo produce APROBADO', async () => {
  const { dependencias } = crearDependenciasFelices();
  const resultados = await ejecutarCheckpoint5(dependencias);

  assert.equal(resultados.lecturaProtegidaRechazada, 'rechazo_esperado');
  assert.equal(resultados.precondicionEjercicioDisponible, 'exito');
  assert.equal(resultados.registroValidoAceptado, 'exito');
  assert.equal(resultados.propiedadIntentoConfirmada, 'exito');
  assert.equal(resultados.calculoServidorSinParametroCliente, 'exito');
  assert.equal(resultados.rechazoSinAutenticacion, 'rechazo_esperado');
  assert.equal(resultados.sesionesCerradas, 'exito');
  assert.equal(calcularResultadoGlobal(resultados), 'APROBADO');
});

test('ejecutarCheckpoint5: conteo exacto de operaciones en el flujo feliz (nada se agrupa ni se omite)', async () => {
  const { dependencias, llamadas } = crearDependenciasFelices();
  await ejecutarCheckpoint5(dependencias);

  assert.equal(llamadas.iniciarSesionA, 2, 'debe iniciar sesion exactamente 2 veces (fase 1 y verificacion posterior)');
  assert.equal(llamadas.cerrarSesion, 2, 'debe cerrar sesion exactamente 2 veces');
  assert.equal(llamadas.seleccionarEjerciciosRespuestas, 1, 'Control 1 se ejecuta exactamente una vez');
  assert.equal(llamadas.seleccionarEjerciciosDisponibles, 1, 'la precondicion se consulta exactamente una vez');
  assert.equal(llamadas.registrarIntento, 1, 'exactamente un (1) intento valido, nunca mas de uno deliberado');
  assert.equal(llamadas.registrarIntentoManipulado, 1, 'el intento de inyeccion de "correcto" se intenta exactamente una vez');
  assert.equal(llamadas.seleccionarIntentosPropios, 2, 'una vez para verificar propiedad, otra vez para integridad posterior');
  assert.equal(llamadas.registrarIntentoAnonimo, 1, 'el intento sin autenticacion se intenta exactamente una vez');
});

test('ejecutarCheckpoint5: una fuga en el intento de inyectar "correcto" (Control 3) detiene el Control 4, sin nuevas mutaciones', async () => {
  const { dependencias, llamadas } = crearDependenciasFelices();
  dependencias.registrarIntentoManipulado = async () => {
    llamadas.registrarIntentoManipulado += 1;
    return { data: [{ intento_id: 'intento-manipulado', es_correcto: true, fecha: '2026-01-01T00:00:00Z' }], error: null };
  };

  const resultados = await ejecutarCheckpoint5(dependencias);

  assert.equal(resultados.calculoServidorSinParametroCliente, 'fallo_critico');
  assert.equal(resultados.rechazoSinAutenticacion, 'no_ejecutado', 'no debe continuar con mas mutaciones tras una fuga real');
  assert.equal(llamadas.registrarIntentoAnonimo, 0);
  assert.equal(calcularResultadoGlobal(resultados), 'NO APROBADO');
});

test('ejecutarCheckpoint5: fallo de login detiene el flujo de inmediato, sin mutaciones', async () => {
  const { dependencias, llamadas } = crearDependenciasFelices();
  dependencias.iniciarSesionA = async () => {
    llamadas.iniciarSesionA += 1;
    return null;
  };

  const resultados = await ejecutarCheckpoint5(dependencias);

  assert.equal(resultados.lecturaProtegidaRechazada, 'error_tecnico');
  assert.equal(resultados.precondicionEjercicioDisponible, 'no_ejecutado');
  assert.equal(resultados.registroValidoAceptado, 'no_ejecutado');
  assert.equal(resultados.rechazoSinAutenticacion, 'no_ejecutado');
  assert.equal(llamadas.seleccionarEjerciciosRespuestas, 0);
  assert.equal(llamadas.seleccionarEjerciciosDisponibles, 0);
  assert.equal(llamadas.registrarIntento, 0);
  assert.equal(llamadas.registrarIntentoManipulado, 0);
  assert.equal(llamadas.registrarIntentoAnonimo, 0);
  // El cierre de sesion en el bloque finally se intenta de todas formas.
  assert.equal(llamadas.cerrarSesion, 1);
});

test('ejecutarCheckpoint5: una fuga en Control 1 detiene TODO lo posterior (no continua con mutaciones inseguras)', async () => {
  const { dependencias, llamadas } = crearDependenciasFelices();
  dependencias.seleccionarEjerciciosRespuestas = async () => {
    llamadas.seleccionarEjerciciosRespuestas += 1;
    return { data: [{ ejercicio_id: 'e1', respuesta_correcta: 'SECRETO' }], error: null };
  };

  const resultados = await ejecutarCheckpoint5(dependencias);

  assert.equal(resultados.lecturaProtegidaRechazada, 'fallo_critico');
  assert.equal(resultados.precondicionEjercicioDisponible, 'no_ejecutado');
  assert.equal(llamadas.seleccionarEjerciciosDisponibles, 0);
  assert.equal(llamadas.registrarIntento, 0);
  assert.equal(llamadas.registrarIntentoManipulado, 0);
  assert.equal(llamadas.registrarIntentoAnonimo, 0);
  assert.equal(calcularResultadoGlobal(resultados), 'NO APROBADO');
});

test('ejecutarCheckpoint5: precondicion incumplida (sin ejercicios) detiene Control 2, 3 y 4, sin mutaciones', async () => {
  const { dependencias, llamadas } = crearDependenciasFelices();
  dependencias.seleccionarEjerciciosDisponibles = async () => {
    llamadas.seleccionarEjerciciosDisponibles += 1;
    return { data: [], error: null };
  };

  const resultados = await ejecutarCheckpoint5(dependencias);

  assert.equal(resultados.precondicionEjercicioDisponible, 'precondicion_incumplida');
  assert.equal(resultados.registroValidoAceptado, 'no_ejecutado');
  assert.equal(resultados.rechazoSinAutenticacion, 'no_ejecutado');
  assert.equal(llamadas.registrarIntento, 0);
  assert.equal(llamadas.registrarIntentoManipulado, 0);
  assert.equal(llamadas.registrarIntentoAnonimo, 0);
  assert.equal(calcularResultadoGlobal(resultados), 'INCONCLUSO');
});

test('ejecutarCheckpoint5: un fallo ordinario en Control 2 NO detiene el Control 4 (solo las fugas detienen el flujo)', async () => {
  const { dependencias, llamadas } = crearDependenciasFelices();
  dependencias.registrarIntento = async () => {
    llamadas.registrarIntento += 1;
    return { data: null, error: { code: '23514', message: 'check violation inesperada' } };
  };
  // Sin intento creado, la verificacion "antes/despues" debe seguir
  // funcionando con conjuntos vacios.
  dependencias.seleccionarIntentosPropios = async () => {
    llamadas.seleccionarIntentosPropios += 1;
    return { data: [], error: null };
  };

  const resultados = await ejecutarCheckpoint5(dependencias);

  assert.equal(resultados.registroValidoAceptado, 'fallo');
  assert.equal(resultados.propiedadIntentoConfirmada, 'no_ejecutado', 'no hay intento creado que verificar');
  assert.equal(resultados.calculoServidorSinParametroCliente, 'no_ejecutado');
  assert.equal(llamadas.registrarIntentoManipulado, 1, 'el intento de inyeccion se prueba igual, no depende del exito del Control 2');
  assert.equal(llamadas.registrarIntentoAnonimo, 1, 'Control 4 debe ejecutarse igual, no es una condicion insegura');
  assert.equal(resultados.rechazoSinAutenticacion, 'rechazo_esperado');
  assert.equal(calcularResultadoGlobal(resultados), 'NO APROBADO');
});

test('ejecutarCheckpoint5: un intento anonimo aceptado (fuga) se refleja como fallo_critico en el resultado global', async () => {
  const { dependencias } = crearDependenciasFelices();
  dependencias.registrarIntentoAnonimo = async () => ({
    data: [{ intento_id: 'intento-anonimo', es_correcto: true, fecha: '2026-01-01T00:00:00Z' }],
    error: null,
  });

  const resultados = await ejecutarCheckpoint5(dependencias);

  assert.equal(resultados.rechazoSinAutenticacion, 'fallo_critico');
  assert.equal(calcularResultadoGlobal(resultados), 'NO APROBADO');
});

test('ejecutarCheckpoint5: fallo del segundo login (verificacion posterior) produce error_tecnico, no una excepcion', async () => {
  const { dependencias, llamadas } = crearDependenciasFelices();
  dependencias.iniciarSesionA = async () => {
    llamadas.iniciarSesionA += 1;
    // Primera llamada exitosa, segunda llamada (verificacion posterior) falla.
    return llamadas.iniciarSesionA === 1 ? 'usuarioA-id' : null;
  };

  const resultados = await ejecutarCheckpoint5(dependencias);

  assert.equal(resultados.rechazoSinAutenticacion, 'error_tecnico');
  assert.equal(calcularResultadoGlobal(resultados), 'INCONCLUSO');
});

test('ejecutarCheckpoint5: un fallo de cierre de sesion se refleja en sesionesCerradas sin detener el flujo', async () => {
  const { dependencias } = crearDependenciasFelices();
  let vez = 0;
  dependencias.cerrarSesion = async () => {
    vez += 1;
    return vez !== 1; // la primera vez falla, el resto tiene exito
  };

  const resultados = await ejecutarCheckpoint5(dependencias);

  assert.equal(resultados.sesionesCerradas, 'error_tecnico');
  // El resto de los controles no se ve afectado por el fallo de signOut.
  assert.equal(resultados.registroValidoAceptado, 'exito');
});

// ============================================================
// Verificacion estructural del script ejecutable real (SOLO lectura de
// texto -- este archivo nunca se importa, para no arriesgar una ejecucion
// real de main()).
// ============================================================

test('checkpoint5-intentos.mjs existe y nunca se ejecuta automaticamente mas de una vez', () => {
  const contenido = readFileSync(RUTA_SCRIPT, 'utf8');
  const invocacionesMain = contenido.match(/^main\(\);\s*$/gm) ?? [];
  assert.equal(invocacionesMain.length, 1, 'debe llamarse a main() exactamente una vez, sin reintentos automaticos');
});

test('checkpoint5-intentos.mjs valida las variables de entorno requeridas (usando la funcion pura testeable) y bloquea si faltan', () => {
  const contenido = readFileSync(RUTA_SCRIPT, 'utf8');
  assert.ok(contenido.includes('NEXT_PUBLIC_SUPABASE_URL'));
  assert.ok(contenido.includes('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'));
  assert.ok(contenido.includes('configuracionPublicaCompleta(SUPABASE_URL, SUPABASE_KEY)'));
  assert.ok(contenido.includes('process.exit(1)'));
});

test('checkpoint5-intentos.mjs usa exclusivamente el cliente publico, sin service_role ni Management API', () => {
  const contenido = readFileSync(RUTA_SCRIPT, 'utf8');
  assert.ok(!/SERVICE_ROLE_KEY|serviceRoleKey/i.test(contenido));
  assert.ok(!contenido.includes('management'));
  assert.ok(!contenido.includes('.admin.'));
});

test('checkpoint5-intentos.mjs no ejecuta SQL ni hace INSERT directo en intentos', () => {
  const contenido = readFileSync(RUTA_SCRIPT, 'utf8');
  assert.ok(!contenido.includes('.insert('), 'debe usar unicamente la RPC registrar_intento, nunca INSERT directo');
  assert.ok(!/\bselect\s+\*\s+from\b/i.test(contenido), 'no debe contener SQL crudo');
});

test('checkpoint5-intentos.mjs invoca registrar_intento exclusivamente via supabase.rpc', () => {
  const contenido = readFileSync(RUTA_SCRIPT, 'utf8');
  const coincidencias = contenido.match(/supabase\.rpc\('registrar_intento'/g) ?? [];
  assert.ok(
    coincidencias.length >= 3,
    'debe invocar la RPC para el intento valido, el intento con parametro manipulado y el intento sin autenticacion'
  );
});

test('checkpoint5-intentos.mjs incluye un intento diseniado para inyectar "correcto" en una ejecucion real futura (no solo una verificacion estatica de la carga propia)', () => {
  const contenido = readFileSync(RUTA_SCRIPT, 'utf8');
  assert.ok(contenido.includes('registrarIntentoManipulado'), 'debe existir la funcion que intentara la inyeccion en una ejecucion real');
  assert.ok(contenido.includes('PGRST202'), 'debe documentar el codigo real y especifico de PostgREST esperado, no solo el nombre generico');
});

test('checkpoint5-intentos.mjs no solicita credenciales de Usuario Temporal B (el contrato no las necesita)', () => {
  const contenido = readFileSync(RUTA_SCRIPT, 'utf8');
  assert.ok(!contenido.includes('Usuario Temporal B'));
  assert.ok(!contenido.includes('Usuario B'));
});

test('checkpoint5-intentos.mjs nunca imprime el contenido de una lectura de ejercicios_respuestas', () => {
  const contenido = readFileSync(RUTA_SCRIPT, 'utf8');
  assert.ok(!/console\.log\(\s*data\b/.test(contenido));
  assert.ok(!contenido.includes('JSON.stringify(data'));
});

test('checkpoint5-intentos.mjs no imprime contrasenas, tokens ni sesiones completas', () => {
  const contenido = readFileSync(RUTA_SCRIPT, 'utf8');
  assert.ok(!/console\.log\([^)]*password/i.test(contenido));
  assert.ok(!/console\.log\([^)]*credenciales/i.test(contenido));
  assert.ok(!contenido.includes('console.log(data.session'));
  // La contrasena siempre se enmascara con "*", nunca se imprime el caracter real.
  assert.ok(contenido.includes("stdout.write('*')"));
});

test('checkpoint5-intentos.mjs (reportError) nunca lee ni imprime "details"/"hint" de PostgrestError', () => {
  const contenido = readFileSync(RUTA_SCRIPT, 'utf8');
  assert.ok(!contenido.includes('error.details'));
  assert.ok(!contenido.includes('error.hint'));
  assert.ok(!/\.details\b/.test(contenido));
  assert.ok(!/\.hint\b/.test(contenido));
});

test('checkpoint5-intentos.mjs advierte antes de la ejecucion que puede conservar un intento de prueba', () => {
  const contenido = readFileSync(RUTA_SCRIPT, 'utf8');
  assert.ok(/ADVERTENCIA:.*CONSERVA.*intento/is.test(contenido));
});

test('checkpoint5-intentos.mjs devuelve un codigo de salida distinto de cero si el resultado no es APROBADO', () => {
  const contenido = readFileSync(RUTA_SCRIPT, 'utf8');
  assert.ok(contenido.includes("process.exitCode = resultadoGlobal === 'APROBADO' ? 0 : 1;"));
});

test('checkpoint5-intentos.mjs no contiene reintentos automaticos ni temporizadores de repeticion', () => {
  const contenido = readFileSync(RUTA_SCRIPT, 'utf8');
  assert.ok(!contenido.includes('setInterval'));
  assert.ok(!contenido.includes('setTimeout'));
});

// Busca lineas de import reales (que EMPIEZAN, tras recortar espacios, con
// "import"), evitando el falso positivo de que una asercion que MENCIONA
// el texto de un import como cadena (ej. para comprobar su ausencia en
// OTRO archivo) se detecte a si misma como si fuera un import real.
function tieneLineaDeImportReal(contenido, fragmento) {
  return contenido
    .split('\n')
    .some((linea) => linea.trim().startsWith('import') && linea.includes(fragmento));
}

test('este archivo de pruebas nunca importa @supabase/supabase-js ni el script ejecutable real (garantia verificable de que los mocks no contactan Supabase)', () => {
  const contenidoPropio = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  assert.ok(!tieneLineaDeImportReal(contenidoPropio, '@supabase/supabase-js'));
  assert.ok(!tieneLineaDeImportReal(contenidoPropio, 'checkpoint5-intentos.mjs'));
});

test('scripts/lib/checkpoint5-logica.mjs (el modulo bajo prueba) tampoco importa @supabase/supabase-js, https, readline ni Node process APIs de red', () => {
  const contenidoModulo = readFileSync(path.join(RAIZ, 'scripts/lib/checkpoint5-logica.mjs'), 'utf8');
  assert.ok(!tieneLineaDeImportReal(contenidoModulo, '@supabase/supabase-js'));
  assert.ok(!tieneLineaDeImportReal(contenidoModulo, 'node:https'));
  assert.ok(!tieneLineaDeImportReal(contenidoModulo, 'node:http'));
  assert.ok(!tieneLineaDeImportReal(contenidoModulo, 'node:net'));
  assert.ok(!tieneLineaDeImportReal(contenidoModulo, 'node:readline'));
  assert.ok(!tieneLineaDeImportReal(contenidoModulo, 'child_process'));
  // "fetch(" como LLAMADA real (no como substring dentro de un mensaje de
  // error, ej. "fetch failed"): no debe existir ninguna invocacion real.
  assert.ok(!/[^'"A-Za-z]fetch\(/.test(contenidoModulo));
});

test('este archivo de pruebas no usa http/https/net/sockets/procesos externos para comunicarse (solo dependencias inyectadas)', () => {
  const contenidoPropio = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  assert.ok(!tieneLineaDeImportReal(contenidoPropio, 'node:http'));
  assert.ok(!tieneLineaDeImportReal(contenidoPropio, 'node:https'));
  assert.ok(!tieneLineaDeImportReal(contenidoPropio, 'node:net'));
  assert.ok(!tieneLineaDeImportReal(contenidoPropio, 'child_process'));
  assert.ok(!/[^'"A-Za-z]fetch\(/.test(contenidoPropio));
});

test('scripts/checkpoint2, checkpoint3 y checkpoint4 no fueron modificados por la creacion del Checkpoint 5 (verificacion de presencia, no de contenido)', () => {
  for (const relativo of [
    'scripts/checkpoint2-auth-trigger.mjs',
    'scripts/checkpoint3-rls-aislamiento.mjs',
    'scripts/checkpoint4-diagnosticos.mjs',
  ]) {
    assert.doesNotThrow(() => readFileSync(path.join(RAIZ, relativo), 'utf8'));
  }
});
