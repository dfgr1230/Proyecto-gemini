// Pruebas del CICLO ADAPTATIVO completo (Dia 3).
//
// Todo con datos locales: no hay red, no hay Supabase, no hay clave de
// Gemini y no se levanta ningun servidor. La base de datos se sustituye
// por un doble en memoria que respeta las mismas reglas que el esquema
// real (registrar_intento devuelve el veredicto; el cliente nunca lo
// calcula), y Gemini por un doble que responde a partir del contexto que
// realmente recibe.
//
// Las comprobaciones marcadas [ESTATICA] leen el codigo fuente para
// verificar propiedades que solo son observables ahi (que parametros se
// envian, que modulos importa un componente de cliente) y se declaran
// como tales.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ejecutarCicloAdaptativo,
  interpretarIntentoRegistrado,
  normalizarEjercicios,
  normalizarIntentos,
} from './ciclo.ts';
import { construirContextoAnalisis, construirEvidencia, MAXIMO_INTENTOS_EN_CONTEXTO } from './evidencia.ts';
import { construirInstruccionAnalisis, ESQUEMA_ANALISIS, generarAnalisisAdaptativo } from './analisis.ts';
import {
  construirParametrosAnalisis,
  detectarIntentoDuplicado,
  interpretarConsultaAnalisis,
  interpretarResultadoConservacion,
  NOMBRE_RPC_ANALISIS,
} from './persistencia.ts';
import { seleccionarSiguienteActividad } from './siguiente.ts';
import { validarAnalisisAdaptativo, CLAVES_ANALISIS } from './contrato.ts';
import { RAICES_CLINICAS_PROHIBIDAS } from '../diagnostico/contrato.ts';
import { analisisValido } from './ejemplo.test-util.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// Se NORMALIZA a LF al leer, por el mismo motivo que la prueba de hashes
// ya normalizaba por su cuenta: con core.autocrlf activo, un clon o un
// cambio de rama en Windows reescribe los archivos con CRLF, y cualquier
// comprobacion con un "\n" literal empezaria a fallar sin que nadie
// hubiera tocado el SQL. Lo que se vigila es el contenido, no su
// codificacion de salto de linea.
const leer = (relativo) =>
  readFileSync(path.join(RAIZ, relativo), 'utf8').replace(/\r\n/g, '\n');

const RUTA_CICLO = 'src/app/api/adaptar/route.ts';
const RUTA_ORQUESTADOR = 'src/lib/adaptativo/ciclo.ts';

const PERFIL = { estilo_aprendizaje: 'visual', nivel_sugerido: 1, explicacion: 'Aprendes mejor con apoyos visuales.' };

function ejercicio(id, nivel, materia = 'matematicas') {
  return {
    id,
    materia,
    nivel_dificultad: nivel,
    contenido: {
      tipo: 'opcion_multiple',
      enunciado: `Ejercicio ${id}`,
      opciones: { A: '5', B: '4', C: '6', D: '3' },
    },
  };
}

// ----------------------------------------------------------------
// Doble de base de datos en memoria.
//
// Reproduce las reglas que importan del esquema real:
//   - registrar_intento() decide "correcto" comparando con la respuesta
//     oficial, que NUNCA sale de aqui (equivale a ejercicios_respuestas,
//     con RLS activo y sin policies);
//   - solo se ven los intentos del usuario en sesion (equivale a la
//     policy intentos_select_propio).
// ----------------------------------------------------------------
function crearBaseFalsa(opciones = {}) {
  const banco = opciones.banco ?? [ejercicio('e1', 1), ejercicio('e2', 2), ejercicio('e3', 3)];
  const oficiales = opciones.oficiales ?? { e1: 'A', e2: 'A', e3: 'A' };
  const usuario = opciones.usuario ?? 'u1';
  const intentos = [...(opciones.intentos ?? [])];
  const analisis = [...(opciones.analisis ?? [])];
  const almacenDisponible = opciones.almacenDisponible !== false;

  let reloj = 0;
  const siguienteFecha = () => {
    reloj += 1;
    return new Date(Date.UTC(2026, 7, 11, 0, 0, reloj)).toISOString();
  };

  const base = {
    usuario,
    intentos,
    analisis,
    llamadasRegistrar: 0,
    llamadasConservar: 0,

    leerEjercicios: async () => ({ data: banco, error: null }),

    leerIntentos: async () => ({
      data: intentos.filter((i) => i.usuario_id === usuario),
      error: null,
    }),

    leerAnalisisVigente: async () => {
      if (!almacenDisponible) {
        return { data: null, error: { code: 'PGRST205', message: 'no existe' } };
      }
      const propios = analisis
        .filter((a) => a.usuario_id === usuario)
        .sort((a, b) => b.fecha.localeCompare(a.fecha));
      return { data: propios.slice(0, 1), error: null };
    },

    registrarIntento: async (p) => {
      base.llamadasRegistrar += 1;
      const oficial = oficiales[p.p_ejercicio_id];
      if (oficial === undefined) {
        return { data: null, error: { message: 'Ejercicio no encontrado' } };
      }
      const correcto = String(p.p_respuesta_dada).trim().toLowerCase() === oficial.trim().toLowerCase();
      const fila = {
        id: `i${intentos.length + 1}`,
        usuario_id: usuario,
        ejercicio_id: p.p_ejercicio_id,
        respuesta_dada: String(p.p_respuesta_dada).trim(),
        correcto,
        tiempo_respuesta: p.p_tiempo_respuesta,
        fecha: siguienteFecha(),
      };
      intentos.push(fila);
      return { data: [{ intento_id: fila.id, es_correcto: correcto, fecha: fila.fecha }], error: null };
    },

    conservarAnalisis: async (p) => {
      base.llamadasConservar += 1;
      if (!almacenDisponible) {
        return {
          data: null,
          error: { code: 'PGRST202', message: 'Could not find the function' },
        };
      }
      const fila = {
        id: `a${analisis.length + 1}`,
        usuario_id: usuario,
        intento_id: p.p_intento_id,
        analisis: p.p_analisis,
        metadatos: p.p_metadatos,
        fecha: siguienteFecha(),
      };
      analisis.push(fila);
      return { data: [{ analisis_id: fila.id }], error: null };
    },
  };

  return base;
}

// Doble de Gemini: responde a partir del contexto REAL que recibe, de
// modo que si el contexto no llevara el analisis previo o la evidencia
// nueva, la respuesta seria distinta y la prueba fallaria.
function crearGeminiFalso(registro = []) {
  return {
    registro,
    analizar: async (contexto) => {
      registro.push(contexto);
      const ultimo = contexto.evidencia_nueva;
      const acerto = ultimo !== null && ultimo.correcto;
      const nivelBase = ultimo === null ? contexto.perfil_base.nivel_sugerido : ultimo.nivel;
      const nivel = Math.min(5, Math.max(1, acerto ? nivelBase + 1 : nivelBase - 1));
      return {
        estado: 'ok',
        analisis: validarAnalisisAdaptativo(
          analisisValido({
            nivel_recomendado: nivel,
            confianza: contexto.historial.length >= 2 ? 'media' : 'baja',
            justificacion:
              contexto.analisis_previo === null
                ? `Primera iteración: ${acerto ? 'acertaste' : 'fallaste'} en nivel ${nivelBase}.`
                : `Continuación del análisis previo (nivel ${contexto.analisis_previo.nivel_recomendado}): ` +
                  `${acerto ? 'acertaste' : 'fallaste'} en nivel ${nivelBase}.`,
          })
        ).analisis,
        metadatos: {
          modelo: 'modelo-de-prueba',
          duracion_ms: 12,
          motivo_finalizacion: 'STOP',
          caracteres_respuesta: 300,
        },
      };
    },
  };
}

function dependencias(base, gemini) {
  return {
    leerPerfil: async () => ({ estado: 'con_perfil', perfil: PERFIL }),
    leerEjercicios: base.leerEjercicios,
    leerIntentos: base.leerIntentos,
    leerAnalisisVigente: base.leerAnalisisVigente,
    registrarIntento: base.registrarIntento,
    conservarAnalisis: base.conservarAnalisis,
    analizar: gemini.analizar,
  };
}

// ================================================================
// 1. Construccion del contexto con perfil e intentos anteriores
// ================================================================

test('el contexto incluye el perfil base, el historial y la evidencia nueva', () => {
  const banco = [ejercicio('e1', 1), ejercicio('e2', 2)];
  const intentos = [
    { id: 'i1', ejercicio_id: 'e1', correcto: true, fecha: '2026-08-11T00:00:01Z', tiempo_respuesta: 9 },
    { id: 'i2', ejercicio_id: 'e2', correcto: false, fecha: '2026-08-11T00:00:02Z', tiempo_respuesta: 31 },
  ];
  const contexto = construirContextoAnalisis({
    perfilBase: PERFIL,
    analisisPrevio: analisisValido(),
    intentos,
    ejercicios: banco,
  });

  assert.equal(contexto.perfil_base.estilo_aprendizaje, 'visual');
  assert.equal(contexto.perfil_base.nivel_sugerido, 1);
  assert.equal(contexto.historial.length, 2);
  assert.equal(contexto.iteracion, 2);
  assert.deepEqual(contexto.evidencia_nueva, { orden: 2, materia: 'matematicas', nivel: 2, correcto: false, segundos: 31 });
  assert.deepEqual(contexto.niveles_disponibles, [1, 2]);
  assert.equal(contexto.analisis_previo.nivel_recomendado, 2);
});

test('el contexto NO contiene ningun dato personal del estudiante', () => {
  const contexto = construirContextoAnalisis({
    perfilBase: PERFIL,
    analisisPrevio: null,
    intentos: [{ id: 'i1', ejercicio_id: 'e1', correcto: true, fecha: '2026-08-11T00:00:01Z', respuesta_dada: 'A' }],
    ejercicios: [ejercicio('e1', 1)],
  });

  const serializado = JSON.stringify(contexto);
  for (const prohibido of ['usuario_id', 'email', 'nombre', 'diagnostico_id', 'access_token', 'respuesta_dada', 'e1', '2026-08-11']) {
    assert.ok(!serializado.includes(prohibido), `el contexto no debe contener "${prohibido}"`);
  }

  // Y lo mismo en el prompt literal que se envia al modelo.
  const instruccion = construirInstruccionAnalisis(contexto);
  for (const prohibido of ['usuario_id', 'email', 'e1', '2026-08-11']) {
    assert.ok(!instruccion.includes(prohibido), `el prompt no debe contener "${prohibido}"`);
  }
});

test('un intento cuyo ejercicio ya no esta en el banco se descarta, no se inventa su nivel', () => {
  const evidencia = construirEvidencia(
    [
      { id: 'i1', ejercicio_id: 'borrado', correcto: true, fecha: '2026-08-11T00:00:01Z' },
      { id: 'i2', ejercicio_id: 'e1', correcto: false, fecha: '2026-08-11T00:00:02Z' },
    ],
    [ejercicio('e1', 1)]
  );
  assert.equal(evidencia.length, 1);
  assert.equal(evidencia[0].orden, 1);
  assert.equal(evidencia[0].correcto, false);
});

test('el historial enviado al modelo esta acotado', () => {
  const banco = [ejercicio('e1', 1)];
  const muchos = Array.from({ length: MAXIMO_INTENTOS_EN_CONTEXTO + 5 }, (_, n) => ({
    id: `i${n}`,
    ejercicio_id: 'e1',
    correcto: n % 2 === 0,
    fecha: `2026-08-11T00:00:${String(n).padStart(2, '0')}Z`,
  }));
  const evidencia = construirEvidencia(muchos, banco);
  assert.equal(evidencia.length, MAXIMO_INTENTOS_EN_CONTEXTO);
});

test('el prompt lleva el analisis previo cuando existe y lo dice cuando no', () => {
  const sinPrevio = construirInstruccionAnalisis(
    construirContextoAnalisis({ perfilBase: PERFIL, analisisPrevio: null, intentos: [], ejercicios: [ejercicio('e1', 1)] })
  );
  assert.match(sinPrevio, /primera iteración/i);

  const conPrevio = construirInstruccionAnalisis(
    construirContextoAnalisis({
      perfilBase: PERFIL,
      analisisPrevio: analisisValido({ habilidad_prioritaria: 'Restas sin llevar' }),
      intentos: [],
      ejercicios: [ejercicio('e1', 1)],
    })
  );
  assert.match(conPrevio, /Análisis previo/);
  assert.ok(conPrevio.includes('Restas sin llevar'));
});

// ================================================================
// 2. Ejecucion de DOS ITERACIONES CONSECUTIVAS
// ================================================================

test('dos iteraciones consecutivas: la segunda usa el resultado de la primera', async () => {
  const base = crearBaseFalsa();
  const contextos = [];
  const gemini = crearGeminiFalso(contextos);
  const deps = dependencias(base, gemini);

  // --- Iteracion 1: responde bien el ejercicio de nivel 1 ---
  const r1 = await ejecutarCicloAdaptativo(
    { ejercicioId: 'e1', respuestaDada: 'A', tiempoRespuesta: 8 },
    deps
  );
  assert.equal(r1.estado, 'ok');
  assert.equal(r1.intento.correcto, true, 'el veredicto lo da la base, no el cliente');
  assert.equal(r1.iteracion, 1);
  assert.equal(r1.analisisPrevio, null, 'en la primera iteracion no hay analisis previo');
  assert.equal(r1.conservacion, 'conservado');
  assert.equal(r1.analisis.nivel_recomendado, 2, 'acertar en nivel 1 debe recomendar nivel 2');
  assert.equal(r1.analisis.confianza, 'baja');
  assert.equal(r1.siguiente.estado, 'elegida');
  assert.equal(r1.siguiente.ejercicio.id, 'e2', 'la siguiente actividad sale de la recomendacion');
  assert.equal(r1.siguiente.coincide_nivel, true);

  // Estado persistido tras la iteracion 1.
  assert.equal(base.intentos.length, 1);
  assert.equal(base.analisis.length, 1);
  assert.equal(base.analisis[0].intento_id, r1.intento.id, 'el analisis queda ligado a su evidencia');

  // --- Iteracion 2: falla el ejercicio de nivel 2 que se le propuso ---
  const r2 = await ejecutarCicloAdaptativo(
    { ejercicioId: 'e2', respuestaDada: 'C', tiempoRespuesta: 44 },
    deps
  );
  assert.equal(r2.estado, 'ok');
  assert.equal(r2.intento.correcto, false);
  assert.equal(r2.iteracion, 2);

  // LO CENTRAL: el segundo analisis partio del primero.
  assert.notEqual(r2.analisisPrevio, null);
  assert.deepEqual(r2.analisisPrevio, r1.analisis);
  assert.equal(contextos[1].analisis_previo.nivel_recomendado, r1.analisis.nivel_recomendado);
  assert.equal(contextos[1].historial.length, 2, 'el segundo contexto lleva los dos intentos');
  assert.match(r2.analisis.justificacion, /Continuación del análisis previo/);

  // Y la decision cambio segun las respuestas.
  assert.equal(r2.analisis.nivel_recomendado, 1, 'fallar en nivel 2 debe recomendar nivel 1');
  assert.notEqual(r2.analisis.nivel_recomendado, r1.analisis.nivel_recomendado);
  assert.equal(r2.analisis.confianza, 'media', 'con mas evidencia la confianza sube');

  // Estado persistido tras la iteracion 2.
  assert.equal(base.intentos.length, 2);
  assert.equal(base.analisis.length, 2);
  assert.equal(base.analisis[1].intento_id, r2.intento.id);
  assert.notEqual(base.analisis[0].intento_id, base.analisis[1].intento_id);

  // La siguiente actividad ya no puede ser una de las respondidas.
  assert.equal(r2.siguiente.estado, 'elegida');
  assert.ok(!['e1', 'e2'].includes(r2.siguiente.ejercicio.id));
});

test('sin almacen de analisis el ciclo sigue funcionando y lo declara, sin fingir persistencia', async () => {
  const base = crearBaseFalsa({ almacenDisponible: false });
  const gemini = crearGeminiFalso();
  const r = await ejecutarCicloAdaptativo({ ejercicioId: 'e1', respuestaDada: 'A', tiempoRespuesta: 5 }, dependencias(base, gemini));

  assert.equal(r.estado, 'ok');
  assert.equal(r.conservacion, 'almacen_no_disponible');
  assert.notEqual(r.conservacion, 'conservado');
  assert.equal(base.intentos.length, 1, 'el intento SI se conserva: es la fuente de verdad');
});

// ================================================================
// 3. Prevencion de duplicados ante reintentos
// ================================================================

test('un reintento identico no crea un segundo intento', async () => {
  const base = crearBaseFalsa();
  const gemini = crearGeminiFalso();
  const deps = dependencias(base, gemini);

  const primera = await ejecutarCicloAdaptativo({ ejercicioId: 'e1', respuestaDada: 'A', tiempoRespuesta: 5 }, deps);
  const repetida = await ejecutarCicloAdaptativo({ ejercicioId: 'e1', respuestaDada: 'A', tiempoRespuesta: 6 }, deps);

  assert.equal(base.llamadasRegistrar, 1, 'registrar_intento solo debe llamarse una vez');
  assert.equal(base.intentos.length, 1);
  assert.equal(repetida.intento.reutilizado, true);
  assert.equal(repetida.intento.id, primera.intento.id);
  assert.equal(repetida.intento.correcto, primera.intento.correcto);
});

test('una respuesta DISTINTA al mismo ejercicio si es evidencia nueva y se registra', async () => {
  const base = crearBaseFalsa();
  const gemini = crearGeminiFalso();
  const deps = dependencias(base, gemini);

  await ejecutarCicloAdaptativo({ ejercicioId: 'e1', respuestaDada: 'B', tiempoRespuesta: 5 }, deps);
  const segunda = await ejecutarCicloAdaptativo({ ejercicioId: 'e1', respuestaDada: 'A', tiempoRespuesta: 5 }, deps);

  assert.equal(base.llamadasRegistrar, 2);
  assert.equal(base.intentos.length, 2);
  assert.equal(segunda.intento.reutilizado, false);
  assert.equal(segunda.intento.correcto, true);
});

test('la deteccion de duplicados normaliza igual que registrar_intento (0001)', () => {
  const intentos = [{ id: 'i1', ejercicio_id: 'e1', correcto: true, fecha: 'f', respuesta_dada: ' a ' }];
  assert.equal(detectarIntentoDuplicado(intentos, 'e1', 'A').estado, 'duplicado');
  assert.equal(detectarIntentoDuplicado(intentos, 'e1', 'B').estado, 'nuevo');
  assert.equal(detectarIntentoDuplicado(intentos, 'e2', 'A').estado, 'nuevo');
  // Una fila sin respuesta_dada legible no puede declararse duplicada.
  assert.equal(
    detectarIntentoDuplicado([{ id: 'i1', ejercicio_id: 'e1', correcto: true, fecha: 'f' }], 'e1', 'A').estado,
    'nuevo'
  );
});

// ================================================================
// 4. Manejo seguro de un fallo de Gemini
// ================================================================

test('si Gemini falla, el intento se conserva y NO se finge adaptacion', async () => {
  const base = crearBaseFalsa();
  const deps = dependencias(base, { analizar: async () => ({ estado: 'error', categoria: 'proveedor' }) });

  const r = await ejecutarCicloAdaptativo({ ejercicioId: 'e1', respuestaDada: 'A', tiempoRespuesta: 5 }, deps);

  assert.equal(r.estado, 'error');
  assert.equal(r.codigo, 'analisis_no_disponible');
  assert.notEqual(r.intento, null, 'la interfaz debe poder decir que la respuesta si se guardo');
  assert.equal(r.intento.correcto, true);
  assert.equal(base.intentos.length, 1, 'la respuesta original es la fuente de verdad y se conserva');
  assert.equal(base.llamadasConservar, 0, 'no se conserva ningun analisis a medias');
  assert.equal(r.analisis, undefined, 'no existe analisis en el resultado de error');
});

test('un JSON incompleto de Gemini no llega nunca a persistirse', async () => {
  const base = crearBaseFalsa();
  const incompleto = analisisValido();
  delete incompleto.confianza;

  const geminiIncompleto = {
    analizar: async () => {
      const validacion = validarAnalisisAdaptativo(incompleto);
      return validacion.valido
        ? { estado: 'ok', analisis: validacion.analisis, metadatos: null }
        : { estado: 'error', categoria: 'respuesta_invalida' };
    },
  };

  const r = await ejecutarCicloAdaptativo({ ejercicioId: 'e1', respuestaDada: 'A', tiempoRespuesta: 5 }, dependencias(base, geminiIncompleto));
  assert.equal(r.estado, 'error');
  assert.equal(r.codigo, 'analisis_no_disponible');
  assert.equal(base.analisis.length, 0);
});

test('generarAnalisisAdaptativo rechaza texto no JSON y JSON que no cumple el contrato', async () => {
  const contexto = construirContextoAnalisis({ perfilBase: PERFIL, analisisPrevio: null, intentos: [], ejercicios: [] });

  const noJson = await generarAnalisisAdaptativo(contexto, {
    llamar: async () => ({ estado: 'ok', texto: 'Claro, aquí tienes: {"a":1}', metadatos: null }),
  });
  assert.equal(noJson.estado, 'error');
  assert.equal(noJson.categoria, 'respuesta_invalida');

  const jsonMalo = await generarAnalisisAdaptativo(contexto, {
    llamar: async () => ({ estado: 'ok', texto: JSON.stringify({ fortalezas: [] }), metadatos: null }),
  });
  assert.equal(jsonMalo.estado, 'error');

  const bueno = await generarAnalisisAdaptativo(contexto, {
    llamar: async () => ({
      estado: 'ok',
      texto: JSON.stringify(analisisValido()),
      metadatos: { modelo: 'm', duracion_ms: 1, motivo_finalizacion: 'STOP', caracteres_respuesta: 10 },
    }),
  });
  assert.equal(bueno.estado, 'ok');
  assert.equal(bueno.metadatos.modelo, 'm');
});

test('una respuesta vacia del proveedor se trata como respuesta invalida', async () => {
  const contexto = construirContextoAnalisis({ perfilBase: PERFIL, analisisPrevio: null, intentos: [], ejercicios: [] });
  for (const categoria of ['configuracion', 'red', 'proveedor', 'respuesta_vacia']) {
    const r = await generarAnalisisAdaptativo(contexto, { llamar: async () => ({ estado: 'error', categoria }) });
    assert.equal(r.estado, 'error');
    assert.equal(r.categoria, categoria === 'respuesta_vacia' ? 'respuesta_invalida' : categoria);
  }
});

// ================================================================
// 5. Persistencia: interpretacion estricta de las respuestas
// ================================================================

test('no se declara conservado sin evidencia positiva de la fila', () => {
  assert.equal(interpretarResultadoConservacion({ data: [{ analisis_id: 'a1' }], error: null }), 'conservado');
  assert.equal(interpretarResultadoConservacion({ data: [], error: null }), 'no_conservado');
  assert.equal(interpretarResultadoConservacion({ data: null, error: null }), 'no_conservado');
  assert.equal(interpretarResultadoConservacion({ data: [{}], error: null }), 'no_conservado');
  assert.equal(interpretarResultadoConservacion({ data: [{ analisis_id: 3 }], error: null }), 'no_conservado');
});

test('la carencia del almacen se distingue de un fallo real', () => {
  assert.equal(
    interpretarResultadoConservacion({ data: null, error: { code: 'PGRST202' } }),
    'almacen_no_disponible'
  );
  assert.equal(
    interpretarResultadoConservacion({ data: null, error: { code: '42501' } }),
    'almacen_no_disponible'
  );
  assert.equal(
    interpretarResultadoConservacion({ data: null, error: { code: '23505', message: 'duplicate' } }),
    'no_conservado'
  );
});

test('el analisis conservado se vuelve a validar al releerlo', () => {
  const bueno = interpretarConsultaAnalisis({ data: [{ analisis: analisisValido() }], error: null }, validarAnalisisAdaptativo);
  assert.equal(bueno.estado, 'con_analisis');

  const manipulado = analisisValido({ nivel_recomendado: 99 });
  const malo = interpretarConsultaAnalisis({ data: [{ analisis: manipulado }], error: null }, validarAnalisisAdaptativo);
  assert.equal(malo.estado, 'error', 'una fila que no cumple el contrato no se usa como contexto');

  assert.equal(interpretarConsultaAnalisis({ data: [], error: null }, validarAnalisisAdaptativo).estado, 'sin_analisis');
  assert.equal(
    interpretarConsultaAnalisis({ data: null, error: { code: 'PGRST205' } }, validarAnalisisAdaptativo).estado,
    'almacen_no_disponible'
  );
});

test('los parametros de conservacion ligan el analisis a su evidencia y no llevan usuario_id', () => {
  const parametros = construirParametrosAnalisis('i7', analisisValido(), {
    modelo: 'gemini-3.6-flash',
    duracion_ms: 1200,
    motivo_finalizacion: 'STOP',
    caracteres_respuesta: 412,
  });

  assert.equal(parametros.p_intento_id, 'i7');
  assert.equal(parametros.p_metadatos.modelo, 'gemini-3.6-flash');
  const claves = Object.keys(parametros);
  assert.deepEqual(claves.sort(), ['p_analisis', 'p_intento_id', 'p_metadatos']);
  const serializado = JSON.stringify(parametros);
  for (const prohibido of ['usuario_id', 'auth', 'apikey', 'GEMINI_API_KEY', 'Bearer']) {
    assert.ok(!serializado.includes(prohibido), `los parametros no deben incluir "${prohibido}"`);
  }
});

test('interpretarIntentoRegistrado exige id y veredicto booleano', () => {
  assert.equal(
    interpretarIntentoRegistrado({ data: [{ intento_id: 'i1', es_correcto: true, fecha: 'f' }], error: null }).estado,
    'registrado'
  );
  assert.equal(interpretarIntentoRegistrado({ data: [], error: null }).estado, 'no_registrado');
  assert.equal(interpretarIntentoRegistrado({ data: null, error: { message: 'x' } }).estado, 'no_registrado');
  assert.equal(interpretarIntentoRegistrado({ data: [{ es_correcto: true }], error: null }).estado, 'no_registrado');
  assert.equal(
    interpretarIntentoRegistrado({ data: [{ intento_id: 'i1', es_correcto: 'si' }], error: null }).estado,
    'no_registrado'
  );
});

// ================================================================
// 6. Seleccion de la siguiente actividad
// ================================================================

test('la siguiente actividad respeta materia y nivel recomendados, y excluye lo respondido', () => {
  const banco = [ejercicio('m1', 1), ejercicio('m3', 3), ejercicio('l2', 2, 'lenguaje'), ejercicio('l4', 4, 'lenguaje')];
  const enLenguaje4 = analisisValido({ siguiente_actividad_materia: 'lenguaje', nivel_recomendado: 4 });

  const exacta = seleccionarSiguienteActividad(banco, enLenguaje4, []);
  assert.equal(exacta.ejercicio.id, 'l4');
  assert.equal(exacta.coincide_materia, true);
  assert.equal(exacta.coincide_nivel, true);

  // Con la coincidencia exacta ya respondida manda la cercania de NIVEL,
  // no la materia: m3 esta a un nivel de distancia y l2 a dos.
  const yaRespondido = seleccionarSiguienteActividad(banco, enLenguaje4, [
    { id: 'i1', ejercicio_id: 'l4', correcto: true, fecha: 'f' },
  ]);
  assert.equal(yaRespondido.ejercicio.id, 'm3', 'no puede repetir lo ya respondido');
  assert.equal(yaRespondido.coincide_nivel, false, 'y debe declarar que el nivel no es el ideal');
  assert.equal(yaRespondido.coincide_materia, false, 'ni que la materia lo sea');
});

test('a igual distancia de nivel decide la materia recomendada', () => {
  const banco = [ejercicio('m2', 2), ejercicio('l2', 2, 'lenguaje')];
  const r = seleccionarSiguienteActividad(
    banco,
    analisisValido({ siguiente_actividad_materia: 'lenguaje', nivel_recomendado: 2 }),
    []
  );
  assert.equal(r.ejercicio.id, 'l2');
  assert.equal(r.coincide_materia, true);
});

test('empate de distancia y materia: se prefiere el nivel mas bajo', () => {
  const banco = [ejercicio('a', 2), ejercicio('b', 4)];
  const r = seleccionarSiguienteActividad(banco, analisisValido({ nivel_recomendado: 3 }), []);
  assert.equal(r.ejercicio.nivel_dificultad, 2);
});

test('estados honestos cuando el banco no da mas de si', () => {
  assert.equal(seleccionarSiguienteActividad([], analisisValido(), []).estado, 'sin_ejercicios');
  assert.equal(
    seleccionarSiguienteActividad([ejercicio('e1', 1)], analisisValido(), [
      { id: 'i1', ejercicio_id: 'e1', correcto: true, fecha: 'f' },
    ]).estado,
    'sin_pendientes'
  );
});

// ================================================================
// 7. Estados de error tempranos del ciclo
// ================================================================

test('sin perfil el ciclo no registra nada', async () => {
  const base = crearBaseFalsa();
  const deps = { ...dependencias(base, crearGeminiFalso()), leerPerfil: async () => ({ estado: 'sin_diagnostico' }) };
  const r = await ejecutarCicloAdaptativo({ ejercicioId: 'e1', respuestaDada: 'A', tiempoRespuesta: 1 }, deps);
  assert.equal(r.codigo, 'sin_perfil');
  assert.equal(base.intentos.length, 0);
  assert.equal(base.llamadasRegistrar, 0);
});

test('un ejercicio ajeno al banco o una opcion inexistente se rechazan antes de escribir', async () => {
  const base = crearBaseFalsa();
  const deps = dependencias(base, crearGeminiFalso());

  const desconocido = await ejecutarCicloAdaptativo({ ejercicioId: 'zz', respuestaDada: 'A', tiempoRespuesta: 1 }, deps);
  assert.equal(desconocido.codigo, 'ejercicio_desconocido');

  const opcionMala = await ejecutarCicloAdaptativo({ ejercicioId: 'e1', respuestaDada: 'Z', tiempoRespuesta: 1 }, deps);
  assert.equal(opcionMala.codigo, 'respuesta_invalida');

  assert.equal(base.llamadasRegistrar, 0);
});

test('un fallo de lectura no se confunde con "sin datos"', async () => {
  const base = crearBaseFalsa();
  const deps = { ...dependencias(base, crearGeminiFalso()), leerIntentos: async () => ({ data: null, error: { message: 'red' } }) };
  const r = await ejecutarCicloAdaptativo({ ejercicioId: 'e1', respuestaDada: 'A', tiempoRespuesta: 1 }, deps);
  assert.equal(r.codigo, 'lectura_fallida');
  assert.equal(base.llamadasRegistrar, 0);
});

test('filas malformadas se descartan sin romper el resto', () => {
  assert.equal(normalizarIntentos([{ id: 'i1', ejercicio_id: 'e1', correcto: true, fecha: 'f' }, null, {}, 7]).length, 1);
  assert.equal(normalizarEjercicios([ejercicio('e1', 1), { id: 'x' }, null]).length, 1);
});

// ================================================================
// 8. [ESTATICA] Aislamiento entre usuarios y secreto de la clave
// ================================================================

test('[ESTATICA] la clave de Gemini nunca se menciona en codigo de cliente', () => {
  const componentes = [];
  const recorrer = (dir) => {
    for (const entrada of readdirSync(path.join(RAIZ, dir), { withFileTypes: true })) {
      const relativo = `${dir}/${entrada.name}`;
      if (entrada.isDirectory()) recorrer(relativo);
      else if (entrada.name.endsWith('.tsx') || entrada.name.endsWith('.ts')) componentes.push(relativo);
    }
  };
  recorrer('src/components');
  recorrer('src/app');

  for (const relativo of componentes) {
    const contenido = leer(relativo);
    const esCliente = contenido.includes("'use client'");
    if (!esCliente) continue;
    assert.ok(!contenido.includes('GEMINI_API_KEY'), `${relativo} no debe mencionar la clave`);
    assert.ok(!contenido.includes('@/lib/gemini/'), `${relativo} no debe importar el cliente de Gemini`);
    assert.ok(
      !contenido.includes('@/lib/adaptativo/analisis'),
      `${relativo} no debe importar la orquestacion de Gemini`
    );
  }
});

test('[ESTATICA] la ruta del ciclo no acepta ninguna identidad enviada por el navegador', () => {
  const fuente = leer(RUTA_CICLO);
  for (const prohibido of ['c.usuario_id', 'usuario_id:', 'p_usuario_id', 'service_role', 'SERVICE_ROLE']) {
    assert.ok(!fuente.includes(prohibido), `la ruta no debe usar "${prohibido}"`);
  }
  // La identidad se verifica contra el servidor de Auth, no decodificando
  // el token localmente.
  assert.ok(fuente.includes('verificarUsuario'));
  assert.ok(fuente.includes('extraerTokenBearer'));
});

test('[ESTATICA] ninguna consulta del ciclo filtra por un identificador de usuario del cliente', () => {
  const fuente = leer(RUTA_CICLO);
  // Quien restringe las filas es RLS (policies *_select_propio). Un
  // .eq('usuario_id', ...) aqui daria la falsa impresion de que la
  // seguridad depende del cliente.
  assert.ok(!/\.eq\(\s*['"]usuario_id['"]/.test(fuente), 'no debe filtrar por usuario_id');
});

test('[ESTATICA] el veredicto nunca se envia desde el servidor a registrar_intento', () => {
  const fuente = leer(RUTA_ORQUESTADOR);
  for (const prohibido of ['p_correcto', 'p_es_correcto', 'p_usuario_id']) {
    assert.ok(!fuente.includes(prohibido), `no debe enviarse "${prohibido}"`);
  }
  assert.ok(fuente.includes('p_ejercicio_id'));
  assert.ok(fuente.includes('p_respuesta_dada'));
  assert.ok(fuente.includes('p_tiempo_respuesta'));
});

test('[ESTATICA] el esquema exigido al modelo coincide con el contrato validado', () => {
  assert.deepEqual([...ESQUEMA_ANALISIS.required].sort(), [...CLAVES_ANALISIS].sort());
  assert.deepEqual(Object.keys(ESQUEMA_ANALISIS.properties).sort(), [...CLAVES_ANALISIS].sort());
});

test('[ESTATICA] la RPC de conservacion se nombra en un unico lugar', () => {
  const privilegiado = leer(RUTA_PRIVILEGIADO);
  assert.ok(privilegiado.includes('NOMBRE_RPC_ANALISIS'));
  assert.ok(
    !privilegiado.includes(`'${NOMBRE_RPC_ANALISIS}'`),
    'el nombre no debe repetirse literal fuera de persistencia.ts'
  );
  // La ruta ya no llama a la RPC: delega en el modulo privilegiado.
  assert.ok(!leer(RUTA_CICLO).includes(NOMBRE_RPC_ANALISIS));
});

// ================================================================
// 8 bis. [ESTATICA] Procedencia de la escritura
//
// El analisis solo puede entrar por /api/adaptar, con una credencial que
// el navegador no tiene. Estas comprobaciones vigilan que ese privilegio
// no se extienda ni se filtre.
// ================================================================

const RUTA_PRIVILEGIADO = 'src/lib/supabase/servidorPrivilegiado.ts';
const VARIABLE_SECRETA = 'SUPABASE_SECRET_KEY';

test('[ESTATICA] la clave secreta se lee en UN solo archivo del proyecto', () => {
  const archivos = [];
  const recorrer = (dir) => {
    for (const entrada of readdirSync(path.join(RAIZ, dir), { withFileTypes: true })) {
      const relativo = `${dir}/${entrada.name}`;
      if (entrada.isDirectory()) recorrer(relativo);
      // Las propias pruebas quedan fuera: nombran la variable para poder
      // vigilarla, y no forman parte de lo que se despliega.
      else if (/\.(ts|tsx|mjs)$/.test(entrada.name) && !/\.test(-util)?\.mjs$/.test(entrada.name)) {
        archivos.push(relativo);
      }
    }
  };
  recorrer('src');

  const conLaClave = archivos.filter((r) => leer(r).includes(VARIABLE_SECRETA));
  assert.deepEqual(conLaClave, [RUTA_PRIVILEGIADO], 'solo el modulo privilegiado puede leerla');
});

test('[ESTATICA] la clave secreta no puede llegar al navegador', () => {
  // Sin el prefijo NEXT_PUBLIC_ Next.js no la incluye en el bundle.
  assert.ok(!VARIABLE_SECRETA.startsWith('NEXT_PUBLIC_'));

  const privilegiado = leer(RUTA_PRIVILEGIADO);
  assert.ok(!privilegiado.includes("'use client'"), 'el modulo debe ser de servidor');
  assert.ok(privilegiado.includes("typeof window !== 'undefined'"), 'debe tener guardia de navegador');
  // Nunca se registra su valor ni su longitud.
  assert.ok(!/console\.[a-z]+\([^)]*clave/i.test(privilegiado));

  // Ningun componente de cliente la menciona ni importa el modulo.
  const componentes = [];
  const recorrer = (dir) => {
    for (const entrada of readdirSync(path.join(RAIZ, dir), { withFileTypes: true })) {
      const relativo = `${dir}/${entrada.name}`;
      if (entrada.isDirectory()) recorrer(relativo);
      else if (/\.(ts|tsx)$/.test(entrada.name)) componentes.push(relativo);
    }
  };
  recorrer('src/components');
  recorrer('src/app');
  for (const relativo of componentes) {
    const contenido = leer(relativo);
    if (!contenido.includes("'use client'")) continue;
    assert.ok(!contenido.includes(VARIABLE_SECRETA), `${relativo} no debe mencionar la clave secreta`);
    assert.ok(
      !contenido.includes('servidorPrivilegiado'),
      `${relativo} no debe importar el modulo privilegiado`
    );
  }
});

test('[ESTATICA] el privilegio se limita a una sola llamada RPC', () => {
  const fuente = leer(RUTA_PRIVILEGIADO);

  // Ni una sola lectura o escritura de tabla con esta credencial: las
  // respuestas y calificaciones originales se siguen escribiendo con la
  // identidad del propio estudiante, bajo RLS.
  assert.ok(!/\.from\(/.test(fuente), 'el modulo privilegiado no debe consultar tablas');
  assert.ok(!/\.storage|\.auth\.admin/.test(fuente));

  // Una sola invocacion de rpc, y con el nombre importado.
  assert.equal((fuente.match(/\.rpc\(/g) ?? []).length, 1);
  assert.ok(fuente.includes('cliente.rpc(NOMBRE_RPC_ANALISIS'));

  // El cliente construido no se exporta: nadie mas puede reutilizarlo.
  assert.ok(!/export (const|function) crearCliente/i.test(fuente));
  const exportados = [...fuente.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(exportados.sort(), [
    'conservarAnalisisConCredencialDeServidor',
    'hayCredencialDeServidor',
  ]);
});

test('[ESTATICA] el identificador del intento nunca llega del navegador', () => {
  // La credencial privilegiada omite RLS, asi que toda la autorizacion
  // tiene que haber ocurrido ANTES. Si el navegador pudiera indicar el
  // intento, elegiria a quien pertenece el analisis.
  const ruta = leer(RUTA_CICLO);
  assert.ok(!/c\.intento_id|intento_id:\s*c\./.test(ruta), 'la ruta no debe leer intento_id del cuerpo');
  // Solo tres campos entran desde la peticion.
  assert.ok(ruta.includes('ejercicioId: c.ejercicio_id'));
  assert.ok(ruta.includes('respuestaDada: c.respuesta_dada'));
  assert.ok(ruta.includes('tiempoRespuesta: normalizarTiempo(c.tiempo_respuesta)'));

  const orquestador = leer(RUTA_ORQUESTADOR);
  assert.ok(!/entrada\.intentoId/.test(orquestador));
  // El id sale de la RPC recien ejecutada, o del historial que RLS
  // restringe al propio usuario. No hay una tercera via.
  assert.ok(orquestador.includes('id: registro.id'));
  assert.ok(orquestador.includes('id: duplicado.intento.id'));

  // Y la verificacion de sesion precede al USO de la credencial. Se busca
  // el punto de llamada, no el import: el import vive arriba del archivo
  // y compararlo daria un falso negativo.
  const posSesion = ruta.indexOf("if (usuario.estado === 'sin_sesion')");
  const posPrivilegio = ruta.indexOf('conservarAnalisis: (parametros');
  assert.ok(posSesion > 0, 'la ruta debe verificar la sesion');
  assert.ok(posPrivilegio > posSesion, 'la sesion debe verificarse antes de usar la credencial');
  // El cliente privilegiado se construye dentro de la llamada, no en el
  // ambito del modulo: no existe antes de que haya sesion verificada.
  assert.ok(leer(RUTA_PRIVILEGIADO).includes('const cliente = createClient('));
  assert.ok(!/^const cliente = createClient\(/m.test(leer(RUTA_PRIVILEGIADO)));
});

test('un intento ajeno no puede reutilizarse como propio', async () => {
  // El historial que llega al ciclo esta restringido por RLS, asi que un
  // intento de otra persona no aparece. Si apareciera, detectarIntento-
  // Duplicado lo tomaria por propio y el analisis acabaria colgando de
  // evidencia ajena. Se comprueba con un intento de otro usuario sembrado
  // en la base falsa.
  const base = crearBaseFalsa({
    usuario: 'u1',
    intentos: [
      {
        id: 'ajeno-1',
        usuario_id: 'u2',
        ejercicio_id: 'e1',
        respuesta_dada: 'A',
        correcto: true,
        tiempo_respuesta: 5,
        fecha: '2026-08-11T00:00:00.000Z',
      },
    ],
  });

  const r = await ejecutarCicloAdaptativo(
    { ejercicioId: 'e1', respuestaDada: 'A', tiempoRespuesta: 5 },
    dependencias(base, crearGeminiFalso())
  );

  assert.equal(r.estado, 'ok');
  assert.equal(r.intento.reutilizado, false, 'no puede tomar por propio un intento ajeno');
  assert.notEqual(r.intento.id, 'ajeno-1');
  assert.equal(base.llamadasRegistrar, 1, 'debe registrar uno nuevo a su nombre');
  // Y el analisis queda ligado al intento propio, no al ajeno.
  assert.equal(base.analisis[0].intento_id, r.intento.id);
  assert.equal(base.analisis[0].usuario_id, 'u1');
});

test('[ESTATICA] la falta de credencial es un estado declarado, no un exito', () => {
  const fuente = leer(RUTA_PRIVILEGIADO);
  assert.ok(fuente.includes('CODIGO_CREDENCIAL_AUSENTE'));
  const persistencia = leer('src/lib/adaptativo/persistencia.ts');
  assert.ok(persistencia.includes("return 'credencial_ausente'"));
});

test('la ausencia de credencial no se confunde con un fallo ni con exito', () => {
  assert.equal(
    interpretarResultadoConservacion({ data: null, error: { code: 'CONFIG_CREDENCIAL_AUSENTE' } }),
    'credencial_ausente'
  );
});

test('sin metadatos de la llamada el analisis no se conserva', async () => {
  const base = crearBaseFalsa();
  const geminiSinMetadatos = {
    analizar: async () => ({
      estado: 'ok',
      analisis: validarAnalisisAdaptativo(analisisValido()).analisis,
      metadatos: null,
    }),
  };
  const r = await ejecutarCicloAdaptativo(
    { ejercicioId: 'e1', respuestaDada: 'A', tiempoRespuesta: 3 },
    dependencias(base, geminiSinMetadatos)
  );
  assert.equal(r.estado, 'ok');
  assert.equal(r.conservacion, 'no_conservado');
  assert.equal(base.llamadasConservar, 0, 'no se llama a la RPC sin evidencia de la llamada');
  assert.equal(base.analisis.length, 0);
  assert.equal(base.intentos.length, 1, 'el intento si se conserva: es la fuente de verdad');
});

// ================================================================
// 9. [ESTATICA] Los borradores de 0005 y 0006
//
// LIMITE EXPLICITO, sin matices: estas comprobaciones LEEN EL TEXTO de
// los archivos. Es arquitectura SQL que TODAVIA NO SE HA EJECUTADO --
// NO demuestran el comportamiento real de la RPC, de los GRANT/REVOKE,
// de los CHECK ni de las policies en PostgreSQL. Es el mismo criterio
// (y el mismo limite) con el que se auditó 0004 antes de aplicarla.
// ================================================================

const RUTA_0005 = 'supabase/migrations/0005_dia3_analisis_adaptativos.sql';
const RUTA_0006 = 'supabase/migrations/0006_dia3_ampliar_banco.sql';

// Las prohibiciones se comprueban sobre el SQL EJECUTABLE: los
// comentarios de los archivos mencionan a proposito lo que NO se hace
// ("no introduce service_role"), y buscarlo en el texto completo
// convertiria esa explicacion en un falso positivo.
const sqlEjecutable = (texto) =>
  texto
    .split('\n')
    .filter((linea) => !linea.trimStart().startsWith('--'))
    .join('\n');

test('[ESTATICA] el historial de migraciones es exactamente el previsto', () => {
  const migraciones = readdirSync(path.join(RAIZ, 'supabase/migrations')).sort();
  assert.deepEqual(migraciones, [
    '0001_dia2_esquema_base.sql',
    '0002_dia2_seed_ejercicio_minimo.sql',
    '0003_dia2_corregir_registrar_intento_fecha.sql',
    '0004_dia3_guardar_perfil_detectado.sql',
    '0005_dia3_analisis_adaptativos.sql',
    '0006_dia3_ampliar_banco.sql',
    '0007_dia3_ampliar_banco_a_diez.sql',
  ]);
});

test('[ESTATICA] las migraciones ya aplicadas siguen intactas', () => {
  // Toda migracion aplicada es inmutable (criterio fijado en el "Cierre
  // del Checkpoint 5"): reescribir uno de estos archivos haria que el
  // repositorio dejara de describir la base de datos real.
  //
  // El hash se calcula sobre el contenido NORMALIZADO a LF. Fijar el
  // hash del archivo en bruto ataria la prueba a la configuracion
  // core.autocrlf de cada maquina: un clon en Windows convertiria los
  // finales de linea y la prueba fallaria sin que nadie hubiera tocado
  // el SQL. Lo que se vigila es el contenido, no su codificacion de
  // salto de linea.
  // El de 0001 coincide con el SHA-256 anotado en docs/PROGRESO.md el
  // dia que se escribio esa migracion, lo que confirma de paso que la
  // normalizacion reproduce el calculo original.
  const esperados = {
    '0001_dia2_esquema_base.sql':
      '4402D8CE5E6183684ABC333C1ECD4E9501F27CE9977041F65F09AD6EA303BC25',
    '0002_dia2_seed_ejercicio_minimo.sql':
      '2D6176699B07AED9A28A5DEE50D0C971ED29A13E8DB2122B8987A5BFA67D069C',
    '0003_dia2_corregir_registrar_intento_fecha.sql':
      '6657FD0CD6CB408DDCB4B3BDD4ACCB71C777E980273C41AED31F9C3F402A0127',
    '0004_dia3_guardar_perfil_detectado.sql':
      '6803F504037151DB600B927B6AAE0C0E65BAD15269875F38643513C646D5DBA4',
    '0005_dia3_analisis_adaptativos.sql':
      '71A3B8FDD5FAE79EA0A32F43BBC1DB2EEEAC157011B702CD49DB106CE8C7226A',
    '0006_dia3_ampliar_banco.sql':
      '2D54D84FB7483F437E7378F89E0E863E790103E923C1EC277B8AE14FFE7584D1',
  };
  for (const [nombre, esperado] of Object.entries(esperados)) {
    const contenido = readFileSync(path.join(RAIZ, 'supabase/migrations', nombre), 'utf8').replace(
      /\r\n/g,
      '\n'
    );
    const real = createHash('sha256').update(contenido, 'utf8').digest('hex').toUpperCase();
    assert.equal(real, esperado, `${nombre} fue modificada`);
  }
});

test('[ESTATICA] cada migracion nueva es una transaccion unica y completa', () => {
  for (const ruta of [RUTA_0005, RUTA_0006]) {
    const sql = sqlEjecutable(leer(ruta));
    assert.equal((sql.match(/^begin;$/gm) ?? []).length, 1, `${ruta} debe abrir una sola transaccion`);
    assert.equal((sql.match(/^commit;$/gm) ?? []).length, 1, `${ruta} debe cerrarla una sola vez`);
    assert.ok(!/rollback/i.test(sql), `${ruta} no debe contener rollback`);
  }
});

test('[ESTATICA] la estructura y el contenido del banco viven en migraciones separadas', () => {
  const estructura = sqlEjecutable(leer(RUTA_0005));
  const banco = sqlEjecutable(leer(RUTA_0006));

  // 0005 no toca contenido pedagogico.
  assert.ok(!/insert into public\.ejercicios/i.test(estructura));
  assert.ok(!/insert into public\.ejercicios_respuestas/i.test(estructura));

  // 0006 no toca estructura.
  assert.ok(!/create table/i.test(banco));
  assert.ok(!/create policy/i.test(banco));
  assert.ok(!/create or replace function/i.test(banco));
  assert.ok(!/grant |revoke /i.test(banco));
  assert.ok(!/row level security/i.test(banco));
});

test('[ESTATICA] 0005 declara las mismas raices clinicas que TypeScript (paridad)', () => {
  const sql = leer(RUTA_0005);
  for (const raiz of RAICES_CLINICAS_PROHIBIDAS) {
    assert.ok(sql.includes(`'${raiz}'`), `falta la raiz "${raiz}" en el SQL`);
  }
});

test('[ESTATICA] 0005 exige exactamente las nueve claves del contrato', () => {
  const sql = leer(RUTA_0005);
  assert.ok(sql.includes('<> 9'), 'debe exigir exactamente nueve claves');
  for (const clave of CLAVES_ANALISIS) {
    assert.ok(sql.includes(`? '${clave}'`), `el SQL no comprueba la clave "${clave}"`);
  }
});

test('[ESTATICA] 0005 comprueba el vocabulario clinico texto por texto, no concatenado', () => {
  const sql = sqlEjecutable(leer(RUTA_0005));
  // Concatenar los textos y normalizar borraria los espacios, de modo que
  // dos campos contiguos podrian formar una raiz que ninguno contiene.
  assert.ok(sql.includes('foreach v_texto in array v_textos loop'));
  assert.ok(!/v_todos/.test(sql), 'no debe quedar rastro de la comparacion concatenada');
});

test('[ESTATICA] 0005 canoniza igual que TypeScript, sin extensiones', () => {
  const sql = leer(RUTA_0005);
  assert.ok(sql.includes('regexp_replace(lower(normalize('));
  assert.ok(sql.includes("'[^a-z0-9]', '', 'g'"));
  assert.ok(!/create extension/i.test(sql), 'no debe crear ninguna extension');
  assert.ok(!/unaccent/i.test(sql));
});

test('[ESTATICA] 0005 exige metadatos y los valida', () => {
  const sql = leer(RUTA_0005);
  assert.ok(sql.includes('create or replace function public.es_metadatos_analisis_valido'));
  // NOT NULL: son la unica evidencia estructurada de que hubo llamada.
  assert.ok(
    sql.includes('metadatos jsonb not null check (public.es_metadatos_analisis_valido(metadatos))')
  );
  assert.ok(sql.includes('if not public.es_metadatos_analisis_valido(p_metadatos)'));

  // Las cuatro claves que produce construirParametrosAnalisis().
  const parametros = construirParametrosAnalisis('i1', analisisValido(), {
    modelo: 'm',
    duracion_ms: 1,
    motivo_finalizacion: 'STOP',
    caracteres_respuesta: 1,
  });
  for (const clave of Object.keys(parametros.p_metadatos)) {
    assert.ok(sql.includes(`? '${clave}'`), `el SQL no comprueba el metadato "${clave}"`);
  }
});

test('[ESTATICA] usuario_id se deriva de la fila del intento, nunca de un parametro', () => {
  const sql = leer(RUTA_0005);
  const ejecutable = sqlEjecutable(sql);

  // El propietario sale de la fila del intento.
  assert.ok(sql.includes('select i.usuario_id'));
  assert.ok(sql.includes('where i.id = p_intento_id'));
  assert.ok(sql.includes('values (v_usuario_id, p_intento_id, p_analisis, p_metadatos)'));

  // Y nunca de un parametro ni del JSON.
  assert.ok(!/p_usuario_id/.test(ejecutable), 'la RPC no debe aceptar un identificador de usuario');
  assert.ok(!/p_analisis\s*->>?\s*'usuario/.test(ejecutable));

  // Guardia para un futuro con sesion: si la hay, debe ser la del dueno.
  assert.ok(sql.includes('v_llamante uuid := auth.uid()'));
  assert.ok(sql.includes('if v_llamante is not null and v_llamante <> v_usuario_id then'));

  assert.ok(sql.includes('set search_path = pg_catalog'));
  assert.ok(sql.includes('security definer'));
});

test('[ESTATICA] 0005 evita la ambiguedad de columna que costo la migracion 0003', () => {
  const sql = leer(RUTA_0005);
  // Los parametros de salida se llaman distinto que las columnas...
  assert.ok(sql.includes('analisis_id uuid,'));
  assert.ok(sql.includes('analisis_version bigint,'));
  assert.ok(sql.includes('creado_en timestamptz'));
  for (const colision of ['returns table (\n  id ', '  version bigint,\n  creado_en', '  fecha timestamptz\n)']) {
    assert.ok(!sql.includes(colision), `parametro de salida homonimo de una columna: ${colision}`);
  }
  // ...y ademas toda referencia va calificada con el alias de la tabla.
  assert.ok(sql.includes('returning a.id, a.version, a.fecha into'));
  assert.ok(sql.includes('select a.id, a.version, a.fecha'));
});

test('[ESTATICA] la validacion ocurre ANTES del INSERT', () => {
  const sql = leer(RUTA_0005);
  const validacion = sql.indexOf('if not public.es_analisis_adaptativo_valido(p_analisis)');
  const insercion = sql.indexOf('insert into public.analisis_adaptativos as a');
  assert.ok(validacion > 0 && insercion > 0);
  assert.ok(validacion < insercion, 'el INSERT no puede preceder a la validacion');
});

test('[ESTATICA] la existencia del intento se comprueba antes del INSERT', () => {
  const sql = leer(RUTA_0005);
  const existencia = sql.indexOf("raise exception 'El intento no existe'");
  const insercion = sql.indexOf('insert into public.analisis_adaptativos as a');
  assert.ok(existencia > 0 && existencia < insercion);
});

test('[ESTATICA] la RPC es idempotente sin depender de comprobar-y-luego-insertar', () => {
  const sql = sqlEjecutable(leer(RUTA_0005));
  assert.ok(sql.includes('on conflict on constraint analisis_adaptativos_intento_unico do nothing'));
  // Nunca se sobrescribe un analisis ya conservado.
  assert.ok(!/on conflict[\s\S]{0,80}do update/i.test(sql));
  assert.ok(!/update public\.analisis_adaptativos/i.test(sql));
  // Y una carrera perdida se declara en voz alta, no se devuelve vacia.
  assert.ok(sql.includes('escritura concurrente sobre el mismo intento'));
});

test('[ESTATICA] el navegador NO puede ejecutar la RPC de conservacion', () => {
  const sql = leer(RUTA_0005);
  const firma = 'public.guardar_analisis_adaptativo (uuid, jsonb, jsonb)';

  // Lo esencial de la correccion de procedencia: ni anon ni authenticated
  // reciben EXECUTE, de modo que un usuario no puede colgar de su propio
  // intento un analisis que Gemini nunca produjo.
  for (const rol of ['public', 'anon', 'authenticated']) {
    assert.ok(
      sql.includes(`revoke all on function ${firma} from ${rol};`),
      `falta revoke de la RPC para ${rol}`
    );
  }
  assert.ok(sql.includes(`grant execute on function ${firma} to service_role;`));
  assert.ok(
    !sql.includes(`grant execute on function ${firma} to authenticated;`),
    'authenticated no puede recibir EXECUTE'
  );

  // Las funciones de validacion no quedan ejecutables por ningun rol de
  // la API: solo las usa la RPC, que corre como su propietario.
  for (const funcion of ['es_analisis_adaptativo_valido', 'es_metadatos_analisis_valido']) {
    for (const rol of ['public', 'anon', 'authenticated']) {
      assert.ok(
        sql.includes(`revoke all on function public.${funcion} (jsonb) from ${rol};`),
        `falta revoke de ${funcion} para ${rol}`
      );
    }
  }
});

test('[ESTATICA] la credencial de servidor tampoco puede escribir la tabla a mano', () => {
  const sql = sqlEjecutable(leer(RUTA_0005));
  // Least privilege: al servidor le basta EXECUTE sobre la RPC. Sin
  // INSERT directo, ni con la clave secreta se puede saltar la
  // validacion, la unicidad por intento ni la derivacion de usuario_id.
  assert.ok(sql.includes('revoke all on public.analisis_adaptativos from service_role;'));
  assert.ok(sql.includes('grant select on public.analisis_adaptativos to service_role;'));
  assert.ok(!/grant (insert|update|delete|all)[^;]*service_role/i.test(sql));
});

test('[ESTATICA] la tabla nueva no abre escritura directa ni debilita RLS', () => {
  const sql = sqlEjecutable(leer(RUTA_0005));
  assert.ok(sql.includes('alter table public.analisis_adaptativos enable row level security;'));
  assert.ok(sql.includes('revoke all on public.analisis_adaptativos from anon, authenticated;'));
  assert.ok(sql.includes('grant select on public.analisis_adaptativos to authenticated;'));
  // La secuencia implicita de la columna IDENTITY tambien se cierra: los
  // privilegios por defecto de Supabase podrian haberla dejado abierta.
  assert.ok(
    sql.includes(
      'revoke all on sequence public.analisis_adaptativos_version_seq from anon, authenticated, service_role;'
    )
  );

  assert.ok(!/grant insert/i.test(sql));
  assert.ok(!/grant update/i.test(sql));
  assert.ok(!/grant delete/i.test(sql));
  assert.ok(!/grant all/i.test(sql));
  assert.ok(!/disable row level security/i.test(sql));

  // Una sola policy, y solo de lectura del propio historial.
  assert.equal((sql.match(/create policy/g) ?? []).length, 1);
  assert.ok(sql.includes('for select'));
  assert.ok(sql.includes('using (auth.uid() = usuario_id)'));
  assert.ok(!/for insert|for update|for delete|for all/i.test(sql));
});

test('[ESTATICA] la tabla nueva no se crea con "if not exists"', () => {
  const sql = sqlEjecutable(leer(RUTA_0005));
  // "if not exists" daria por buena una tabla preexistente SIN aplicar
  // los CHECK ni la restriccion unica de este archivo, y la migracion
  // parecería exitosa con un esquema distinto del descrito.
  assert.ok(sql.includes('create table public.analisis_adaptativos ('));
  assert.ok(!/create table if not exists/i.test(sql));
  assert.ok(!/create index if not exists/i.test(sql));
  assert.ok(!/drop policy if exists/i.test(sql));
});

test('[ESTATICA] la relacion usuario-intento-analisis es inequivoca y el orden determinista', () => {
  const sql = sqlEjecutable(leer(RUTA_0005));
  assert.ok(sql.includes('usuario_id uuid not null references public.usuarios (id) on delete cascade'));
  assert.ok(sql.includes('intento_id uuid not null references public.intentos (id) on delete cascade'));
  assert.ok(sql.includes('constraint analisis_adaptativos_intento_unico unique (intento_id)'));
  // Columna monotona para "el ultimo analisis": ordenar por fecha no es
  // determinista porque now() es el inicio de la transaccion.
  assert.ok(sql.includes('version bigint generated always as identity'));
  assert.ok(sql.includes('(usuario_id, version desc)'));

  // Y la aplicacion debe ordenar por esa misma columna, no por fecha.
  const ruta = leer(RUTA_CICLO);
  assert.ok(ruta.includes("order('version', { ascending: false })"));
  assert.ok(!ruta.includes("order('fecha'"), 'la ruta no debe ordenar por fecha');
});

test('[ESTATICA] 0005 y 0006 no modifican objetos de 0001 a 0004', () => {
  for (const ruta of [RUTA_0005, RUTA_0006]) {
    const sql = sqlEjecutable(leer(ruta)).toLowerCase();
    for (const prohibido of [
      'drop table',
      'drop function',
      'drop policy',
      'alter table public.diagnosticos',
      'alter table public.intentos',
      'alter table public.usuarios',
      'alter table public.ejercicios',
      'create or replace function public.registrar_intento',
      'create or replace function public.guardar_diagnostico_con_perfil',
      'create or replace function public.es_perfil_detectado_valido',
      'create or replace function public.es_respuestas_diagnostico_valido',
      'create or replace function public.handle_new_user',
      'update public.',
      'delete from public.',
    ]) {
      assert.ok(!sql.includes(prohibido), `${ruta} no debe contener "${prohibido}"`);
    }
  }
});

test('[ESTATICA] los nombres del SQL coinciden con lo que consulta la aplicacion', () => {
  const sql = leer(RUTA_0005);
  const ruta = leer(RUTA_CICLO);
  assert.ok(sql.includes('public.analisis_adaptativos'));
  assert.ok(ruta.includes("from('analisis_adaptativos')"));
  assert.ok(ruta.includes("select('analisis')"));
  assert.ok(sql.includes('  analisis jsonb not null'), 'la columna consultada debe llamarse "analisis"');
  assert.ok(sql.includes(`create or replace function public.${NOMBRE_RPC_ANALISIS}`));

  // Los tres parametros que envia construirParametrosAnalisis() son
  // exactamente los de la firma de la RPC.
  const parametros = construirParametrosAnalisis('i1', analisisValido(), {
    modelo: 'm',
    duracion_ms: 1,
    motivo_finalizacion: 'STOP',
    caracteres_respuesta: 1,
  });
  for (const clave of Object.keys(parametros)) {
    assert.ok(sql.includes(`  ${clave} `), `la RPC no declara el parametro "${clave}"`);
  }

  // Y la columna que lee interpretarResultadoConservacion() existe como
  // parametro de salida.
  assert.ok(sql.includes('analisis_id uuid,'));
});

test('[ESTATICA] 0006 mantiene la respuesta oficial fuera del contenido publico', () => {
  const sql = sqlEjecutable(leer(RUTA_0006));

  // El objeto "contenido" es legible por authenticated: no puede llevar
  // ninguna clave con forma de respuesta.
  for (const prohibida of ["'respuesta_correcta'", "'respuesta'", "'correcta'", "'solucion'"]) {
    const enContenido = new RegExp(`jsonb_build_object\\([^;]*${prohibida}`, 'is');
    assert.ok(!enContenido.test(sql.split('insert into public.ejercicios_respuestas')[0]));
  }

  // Y las cuatro respuestas oficiales no pueden ser todas la misma
  // opcion: con un banco pequeno eso permite acertar sin resolver.
  // Solo la lista VALUES del INSERT, no el bloque de verificacion
  // posterior, que repite las mismas letras.
  const bloque = (sql.split('insert into public.ejercicios_respuestas')[1] ?? '').split('do $$')[0];
  const letras = [...bloque.matchAll(/,\s*'([A-D])'\)/g)].map((m) => m[1]);
  assert.equal(letras.length, 4, 'deben declararse cuatro respuestas oficiales');
  assert.ok(new Set(letras).size > 1, 'las respuestas oficiales no pueden ser todas iguales');
});

test('[ESTATICA] 0006 verifica el contenido completo antes de asociar respuestas', () => {
  const sql = sqlEjecutable(leer(RUTA_0006));
  // Comparar solo materia y nivel dejaria pasar el caso que la
  // verificacion existe para detectar: otro ejercicio en el mismo UUID.
  assert.ok(sql.includes('v_contenido is distinct from v_esperado'));
  assert.ok(sql.includes('on conflict (id) do nothing'));
  assert.ok(sql.includes('on conflict (ejercicio_id) do nothing'));
  assert.equal((sql.match(/raise exception/g) ?? []).length, 4, 'cada verificacion debe poder abortar');
});

test('[ESTATICA] los ejercicios de 0006 caben en los CHECK de 0001', () => {
  const sql = sqlEjecutable(leer(RUTA_0006));
  const materias = [...sql.matchAll(/'(matematicas|lenguaje)',\n\s*(\d)/g)];
  assert.ok(materias.length >= 4);
  for (const [, materia, nivel] of materias) {
    assert.ok(['matematicas', 'lenguaje'].includes(materia));
    assert.ok(Number(nivel) >= 1 && Number(nivel) <= 5, `nivel ${nivel} fuera del CHECK 1..5`);
  }
});


// ================================================================
// 10. La ampliacion del banco a DIEZ (0007)
//
// Las marcadas [ESTATICA] LEEN EL TEXTO del archivo, con el mismo limite
// explicito de la seccion 9: 0007 todavia NO se ha aplicado, asi que NO
// demuestran el comportamiento real en PostgreSQL -- demuestran que lo
// que se va a aplicar es exactamente lo que se pretende.
//
// Las pruebas del SELECTOR del final SI son de comportamiento real:
// ejecutan seleccionarSiguienteActividad() sobre el banco de diez tal
// como las migraciones lo describen.
// ================================================================

const RUTA_0007 = 'supabase/migrations/0007_dia3_ampliar_banco_a_diez.sql';

// Extrae las tuplas del INSERT de ejercicios de una migracion escrita con
// el estilo de 0006/0007, y las devuelve con la MISMA forma que produce
// PostgREST al leer public.ejercicios. Asi pueden pasarse por el contrato
// real de la aplicacion en vez de por una copia de sus reglas.
function ejerciciosDeclarados(sql) {
  const bloque = sql.slice(
    sql.indexOf('insert into public.ejercicios (id, materia, nivel_dificultad, contenido)'),
    sql.indexOf('on conflict (id) do nothing')
  );
  const patron =
    /'([0-9a-f-]{36})',\s*'(matematicas|lenguaje)',\s*(\d+),\s*jsonb_build_object\(\s*'tipo',\s*'([^']*)',\s*'enunciado',\s*'([^']*)',\s*'opciones',\s*jsonb_build_object\(([^)]*)\)/g;

  return [...bloque.matchAll(patron)].map((m) => {
    const opciones = {};
    for (const par of m[6].matchAll(/'([^']*)',\s*'([^']*)'/g)) opciones[par[1]] = par[2];
    return {
      id: m[1],
      materia: m[2],
      nivel_dificultad: Number(m[3]),
      contenido: { tipo: m[4], enunciado: m[5], opciones },
    };
  });
}

function respuestasDeclaradas(sql) {
  const bloque = sql.slice(
    sql.indexOf('insert into public.ejercicios_respuestas'),
    sql.indexOf('on conflict (ejercicio_id) do nothing')
  );
  return Object.fromEntries(
    [...bloque.matchAll(/'([0-9a-f-]{36})',\s*'([A-D])'/g)].map((m) => [m[1], m[2]])
  );
}

// Las cinco filas que 0007 EXIGE encontrar antes de insertar nada. Es su
// declaracion del banco de partida, y mas abajo se contrasta contra lo
// que 0002 y 0006 crean de verdad.
function precondicionDeclarada(sql) {
  const bloque = sql.slice(sql.indexOf('values', sql.indexOf('do $$')), sql.indexOf('as previo'));
  return [...bloque.matchAll(/'([0-9a-f-]{36})'::uuid,\s*'(matematicas|lenguaje)',\s*(\d+)/g)].map(
    (m) => ({ id: m[1], materia: m[2], nivel_dificultad: Number(m[3]) })
  );
}

test('[ESTATICA] 0007 es exclusivamente de datos: ninguna sentencia de esquema', () => {
  const sql = sqlEjecutable(leer(RUTA_0007));

  for (const prohibida of [
    /create\s+table/i,
    /create\s+index/i,
    /create\s+policy/i,
    /create\s+(or\s+replace\s+)?function/i,
    /alter\s+table/i,
    /drop\s+/i,
    /truncate/i,
    /grant\s/i,
    /revoke\s/i,
    /row level security/i,
  ]) {
    assert.ok(!prohibida.test(sql), `0007 no debe contener ${prohibida}`);
  }

  // Escrituras destructivas, buscadas como sentencia y no como palabra
  // suelta (los comentarios hablan a proposito de lo que NO se hace).
  assert.ok(!/^\s*delete\s+from/im.test(sql), '0007 no debe borrar filas');
  assert.ok(!/^\s*update\s+public\./im.test(sql), '0007 no debe modificar filas existentes');

  // Solo INSERT, y solo sobre las dos tablas de contenido.
  const inserts = [...sql.matchAll(/insert\s+into\s+(\S+)/gi)].map((m) => m[1]);
  assert.deepEqual(inserts, ['public.ejercicios', 'public.ejercicios_respuestas']);
});

test('[ESTATICA] 0007 es una transaccion unica y completa', () => {
  const sql = sqlEjecutable(leer(RUTA_0007));
  assert.equal((sql.match(/^begin;$/gm) ?? []).length, 1);
  assert.equal((sql.match(/^commit;$/gm) ?? []).length, 1);
  assert.ok(!/rollback/i.test(sql));
});

test('[ESTATICA] 0007 declara exactamente cinco ejercicios y cinco respuestas', () => {
  const sql = leer(RUTA_0007);
  const ejercicios = ejerciciosDeclarados(sql);
  const respuestas = respuestasDeclaradas(sql);

  assert.equal(ejercicios.length, 5, 'deben ser exactamente cinco ejercicios nuevos');
  assert.equal(Object.keys(respuestas).length, 5, 'deben ser exactamente cinco respuestas');

  // Cada ejercicio nuevo tiene su respuesta, y ninguna respuesta cuelga
  // de un ejercicio que este archivo no crea.
  assert.deepEqual(Object.keys(respuestas).sort(), ejercicios.map((e) => e.id).sort());
});

test('[ESTATICA] los ejercicios nuevos cumplen el contrato de la aplicacion', () => {
  const ejercicios = ejerciciosDeclarados(leer(RUTA_0007));
  // normalizarEjercicios descarta todo lo que no pase validarEjercicio, que
  // es la MISMA funcion que usa la interfaz. Si los cinco sobreviven, los
  // cinco cumplen el contrato real -- incluido el rechazo de un contenido
  // que expusiera la respuesta oficial.
  const validos = normalizarEjercicios(ejercicios);
  assert.equal(validos.length, 5, 'los cinco ejercicios deben pasar validarEjercicio');

  for (const e of validos) {
    assert.equal(e.contenido.tipo, 'opcion_multiple');
    const opciones = Object.entries(e.contenido.opciones);
    assert.equal(opciones.length, 4, 'cada actividad ofrece cuatro opciones');
    const textos = opciones.map(([, t]) => t.trim().toLowerCase());
    assert.equal(new Set(textos).size, 4, 'las opciones deben ser distintas entre si');
    assert.ok(e.contenido.enunciado.length > 10, 'el enunciado debe ser legible');
  }
});

test('[ESTATICA] cada respuesta oficial corresponde a una opcion existente', () => {
  const sql = leer(RUTA_0007);
  const ejercicios = ejerciciosDeclarados(sql);
  const respuestas = respuestasDeclaradas(sql);

  for (const e of ejercicios) {
    const oficial = respuestas[e.id];
    assert.ok(
      Object.keys(e.contenido.opciones).includes(oficial),
      `la respuesta oficial "${oficial}" no es una opcion del ejercicio ${e.id.slice(0, 8)}`
    );
  }

  // Mismo criterio que 0006: con un banco pequeno, una respuesta oficial
  // constante permitiria acertar sin resolver.
  assert.ok(
    new Set(Object.values(respuestas)).size > 1,
    'las respuestas oficiales no pueden ser todas iguales'
  );
});

test('[ESTATICA] no hay identificadores duplicados en todo el banco', () => {
  const nuevos = ejerciciosDeclarados(leer(RUTA_0007)).map((e) => e.id);
  const previos = ejerciciosDeclarados(leer(RUTA_0006)).map((e) => e.id);
  const semilla = '00000000-0000-0000-0000-000000000001';

  assert.equal(new Set(nuevos).size, 5, '0007 no puede repetir un id consigo mismo');
  const todos = [semilla, ...previos, ...nuevos];
  assert.equal(todos.length, 10, 'el banco previsto son diez ejercicios');
  assert.equal(new Set(todos).size, 10, 'ningun id puede repetirse entre migraciones');
});

test('[ESTATICA] la precondicion de 0007 describe el banco que 0002 y 0006 crean', () => {
  const precondicion = precondicionDeclarada(leer(RUTA_0007));
  assert.equal(precondicion.length, 5, '0007 debe exigir las cinco filas de partida');

  // Las cuatro de 0006, contrastadas con lo que 0006 declara de verdad.
  for (const e of ejerciciosDeclarados(leer(RUTA_0006))) {
    const exigida = precondicion.find((p) => p.id === e.id);
    assert.ok(exigida, `0007 no exige el ejercicio ${e.id.slice(0, 8)} que crea 0006`);
    assert.equal(exigida.materia, e.materia);
    assert.equal(exigida.nivel_dificultad, e.nivel_dificultad);
  }

  // Y la semilla tecnica de 0002.
  const semilla = precondicion.find((p) => p.id === '00000000-0000-0000-0000-000000000001');
  assert.ok(semilla, '0007 debe exigir la semilla de 0002');
  assert.equal(semilla.materia, 'matematicas');
  assert.equal(semilla.nivel_dificultad, 1);

  const sql0002 = sqlEjecutable(leer('supabase/migrations/0002_dia2_seed_ejercicio_minimo.sql'));
  assert.ok(sql0002.includes('00000000-0000-0000-0000-000000000001'));
  assert.ok(sql0002.includes("'matematicas'"));
});

test('[ESTATICA] la distribucion final prevista es 5 y 5, con 2/2/1 en cada materia', () => {
  const sql = leer(RUTA_0007);
  const banco = [...precondicionDeclarada(sql), ...ejerciciosDeclarados(sql)];
  assert.equal(banco.length, 10);

  const cuenta = (materia, nivel) =>
    banco.filter((e) => e.materia === materia && e.nivel_dificultad === nivel).length;

  assert.equal(banco.filter((e) => e.materia === 'matematicas').length, 5);
  assert.equal(banco.filter((e) => e.materia === 'lenguaje').length, 5);

  assert.deepEqual(
    [cuenta('matematicas', 1), cuenta('matematicas', 2), cuenta('matematicas', 3)],
    [2, 2, 1],
    'matematicas debe quedar 2/2/1'
  );
  assert.deepEqual(
    [cuenta('lenguaje', 1), cuenta('lenguaje', 2), cuenta('lenguaje', 3)],
    [2, 2, 1],
    'lenguaje debe quedar 2/2/1'
  );

  // Que las DOS materias cubran los TRES niveles es justo la condicion
  // que permite a Gemini cambiar de materia sin perder el nivel que
  // acaba de decidir.
  for (const materia of ['matematicas', 'lenguaje']) {
    for (const nivel of [1, 2, 3]) {
      assert.ok(cuenta(materia, nivel) >= 1, `falta ${materia} nivel ${nivel}`);
    }
  }
});

test('[ESTATICA] existe lenguaje nivel 3, que es el hueco que 0007 cierra', () => {
  const nuevos = ejerciciosDeclarados(leer(RUTA_0007));
  const l3 = nuevos.filter((e) => e.materia === 'lenguaje' && e.nivel_dificultad === 3);
  assert.equal(l3.length, 1, '0007 debe aportar exactamente una actividad de lenguaje nivel 3');

  // Antes de 0007 no existia ninguna: es lo que hacia imposible cumplir
  // de forma exacta una recomendacion de "lenguaje, nivel 3".
  const previos = precondicionDeclarada(leer(RUTA_0007)).filter(
    (e) => e.materia === 'lenguaje' && e.nivel_dificultad === 3
  );
  assert.equal(previos.length, 0, 'el banco de partida no tenia lenguaje nivel 3');
});

test('[ESTATICA] 0007 verifica la distribucion resultante y aborta si no cuadra', () => {
  const sql = sqlEjecutable(leer(RUTA_0007));
  assert.ok(sql.includes('v_contenido is distinct from v_esperado'), 'compara el contenido completo');
  assert.ok(sql.includes('on conflict (id) do nothing'));
  assert.ok(sql.includes('on conflict (ejercicio_id) do nothing'));

  // Precondicion, verificacion de parejas y recuento final: todas deben
  // poder abortar la transaccion, no limitarse a registrar un aviso.
  assert.ok((sql.match(/raise exception/g) ?? []).length >= 10, 'cada comprobacion debe poder abortar');

  // El recuento final es lo que convierte el archivo en comprobable en vez
  // de en una lista de INSERT con buena intencion.
  assert.ok(sql.includes('count(*) into v_total from public.ejercicios'));
  assert.ok(/v_total <> 10/.test(sql), 'debe exigir diez ejercicios');
  assert.ok(/v_matematicas <> 5 or v_lenguaje <> 5/.test(sql), 'debe exigir 5 y 5 por materia');
  assert.ok(/v_m1 <> 2 or v_m2 <> 2 or v_m3 <> 1/.test(sql), 'debe exigir 2/2/1 en matematicas');
  assert.ok(/v_l1 <> 2 or v_l2 <> 2 or v_l3 <> 1/.test(sql), 'debe exigir 2/2/1 en lenguaje');
  assert.ok(sql.includes('v_sin_respuesta'), 'ningun ejercicio puede quedar sin respuesta oficial');

  // Un banco desconocido no se silencia: un ejercicio ajeno aborta.
  assert.ok(sql.includes('v_ajenos'), 'debe detectar ejercicios ajenos al historial');
});

test('[ESTATICA] los ejercicios de 0007 caben en los CHECK de 0001', () => {
  for (const e of ejerciciosDeclarados(leer(RUTA_0007))) {
    assert.ok(['matematicas', 'lenguaje'].includes(e.materia));
    assert.ok(e.nivel_dificultad >= 1 && e.nivel_dificultad <= 5);
  }
});

test('[ESTATICA] 0007 no contiene datos personales, enlaces ni vocabulario clinico', () => {
  // Sobre el SQL EJECUTABLE, no sobre el texto completo: la cabecera
  // declara a proposito que el archivo NO anade contenido clinico, y
  // buscar las raices en los comentarios convertiria esa explicacion en
  // un falso positivo. Mismo criterio que el resto de la seccion 9.
  const sql = sqlEjecutable(leer(RUTA_0007)).toLowerCase();
  for (const raiz of RAICES_CLINICAS_PROHIBIDAS) {
    assert.ok(!sql.includes(raiz.toLowerCase()), `0007 no debe mencionar la raiz clinica "${raiz}"`);
  }
  assert.ok(!/@[a-z0-9.-]+\.[a-z]{2,}/i.test(sql), 'sin correos');
  assert.ok(!/https?:\/\//i.test(sql), 'sin recursos externos');
});

// ----------------------------------------------------------------
// Comportamiento REAL del selector sobre el banco de diez.
//
// Estas cuatro no son estaticas: ejecutan la funcion de seleccion con el
// banco que las migraciones describen. Son las que demuestran que la
// ampliacion es UNICAMENTE de contenido y que la logica adaptativa no
// cambio.
// ----------------------------------------------------------------

// El banco se construye a partir de lo que DECLARAN las migraciones, no
// de una lista escrita a mano: si 0007 cambiara, estas pruebas cambian
// con el. Las cinco filas previas solo aportan materia y nivel (es lo que
// la precondicion declara), asi que se les pone un contenido de relleno:
// el selector nunca lo mira.
function bancoDeDiez() {
  const sql = leer(RUTA_0007);
  return [...precondicionDeclarada(sql), ...ejerciciosDeclarados(sql)].map((e) => ({
    id: e.id,
    materia: e.materia,
    nivel_dificultad: e.nivel_dificultad,
    contenido: e.contenido ?? {
      tipo: 'opcion_multiple',
      enunciado: 'Actividad del banco previo',
      opciones: { A: 'una', B: 'otra' },
    },
  }));
}

const intento = (n, ejercicioId) => ({
  id: `i${n}`,
  ejercicio_id: ejercicioId,
  correcto: true,
  fecha: '2026-08-12T10:00:00Z',
});

test('el selector elige coincidencia EXACTA cuando Gemini pide lenguaje nivel 3', () => {
  const r = seleccionarSiguienteActividad(
    bancoDeDiez(),
    analisisValido({ nivel_recomendado: 3, siguiente_actividad_materia: 'lenguaje' }),
    []
  );

  assert.equal(r.estado, 'elegida');
  assert.equal(r.ejercicio.materia, 'lenguaje');
  assert.equal(r.ejercicio.nivel_dificultad, 3);
  assert.equal(r.coincide_materia, true);
  assert.equal(r.coincide_nivel, true);
});

test('el selector encuentra coincidencia exacta en las seis casillas del banco', () => {
  const banco = bancoDeDiez();
  for (const materia of ['matematicas', 'lenguaje']) {
    for (const nivel of [1, 2, 3]) {
      const r = seleccionarSiguienteActividad(
        banco,
        analisisValido({ nivel_recomendado: nivel, siguiente_actividad_materia: materia }),
        []
      );
      assert.equal(r.estado, 'elegida');
      assert.equal(r.coincide_materia, true, `${materia} nivel ${nivel}: materia inexacta`);
      assert.equal(r.coincide_nivel, true, `${materia} nivel ${nivel}: nivel inexacto`);
    }
  }
});

test('el banco de diez NO impone un orden fijo de materias', () => {
  const banco = bancoDeDiez();

  // Primera actividad pedida en lenguaje: se sirve lenguaje, sin obligar
  // a agotar antes las de matematicas.
  const primera = seleccionarSiguienteActividad(
    banco,
    analisisValido({ nivel_recomendado: 1, siguiente_actividad_materia: 'lenguaje' }),
    []
  );
  assert.equal(primera.ejercicio.materia, 'lenguaje');

  // Y se puede volver a matematicas inmediatamente despues.
  const vuelta = seleccionarSiguienteActividad(
    banco,
    analisisValido({ nivel_recomendado: 2, siguiente_actividad_materia: 'matematicas' }),
    [intento(1, primera.ejercicio.id)]
  );
  assert.equal(vuelta.ejercicio.materia, 'matematicas');

  // El selector no conoce ninguna materia por su nombre: la que manda es
  // siempre la que decidio Gemini.
  const fuente = leer('src/lib/adaptativo/siguiente.ts');
  assert.ok(!/'matematicas'/.test(fuente), 'siguiente.ts no debe nombrar una materia concreta');
  assert.ok(!/'lenguaje'/.test(fuente), 'siguiente.ts no debe nombrar una materia concreta');
});

test('el selector conserva su comportamiento adaptativo con el banco de diez', () => {
  const banco = bancoDeDiez();

  // 1. El nivel sigue mandando sobre la materia: si Gemini pide una
  //    materia en un nivel que no existe, se respeta el nivel y se
  //    declara que la coincidencia no fue exacta.
  const sinCoincidencia = seleccionarSiguienteActividad(
    banco,
    analisisValido({ nivel_recomendado: 5, siguiente_actividad_materia: 'lenguaje' }),
    []
  );
  assert.equal(sinCoincidencia.estado, 'elegida');
  assert.equal(sinCoincidencia.ejercicio.nivel_dificultad, 3, 'sirve el nivel mas cercano');
  assert.equal(sinCoincidencia.coincide_nivel, false, 'y lo declara como inexacto');

  // 2. Lo ya respondido no se repite. Con dos actividades por casilla en
  //    los niveles 1 y 2, MANTENER el nivel ya no obliga a repetir
  //    ejercicio -- que es justo lo que ocurre cuando Gemini decide que
  //    conviene consolidar antes de avanzar.
  const primera = seleccionarSiguienteActividad(
    banco,
    analisisValido({ nivel_recomendado: 2, siguiente_actividad_materia: 'matematicas' }),
    []
  );
  const segunda = seleccionarSiguienteActividad(
    banco,
    analisisValido({ nivel_recomendado: 2, siguiente_actividad_materia: 'matematicas' }),
    [intento(1, primera.ejercicio.id)]
  );
  assert.notEqual(segunda.ejercicio.id, primera.ejercicio.id, 'no repite la actividad respondida');
  assert.equal(segunda.coincide_materia, true, 'y sigue siendo una coincidencia exacta');
  assert.equal(segunda.coincide_nivel, true);

  // 3. Agotado el banco se declara, en vez de inventar una actividad.
  const todos = banco.map((e, i) => intento(i, e.id));
  assert.equal(seleccionarSiguienteActividad(banco, analisisValido(), todos).estado, 'sin_pendientes');
});
