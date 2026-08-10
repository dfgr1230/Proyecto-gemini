// Pruebas de la actividad adaptativa (Sprint B).
//
// Todo con datos locales: no hay red, no hay Supabase, no se escribe en
// ninguna tabla y no se levanta ningun servidor. Las comprobaciones
// marcadas [ESTATICA] leen el codigo fuente para verificar propiedades
// que solo son observables ahi (que columna se pide, que parametros se
// envian) y se declaran como tales.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validarEjercicio,
  seleccionarEjercicio,
  calcularNivelSiguiente,
  resumirProgreso,
  interpretarResultadoIntento,
  orientacionParaEstilo,
  NIVEL_MINIMO,
  NIVEL_MAXIMO,
  TIPO_OPCION_MULTIPLE,
} from './contrato.ts';
import { ESTILOS_APRENDIZAJE } from '../diagnostico/preguntas.ts';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RUTA_VISTA = 'src/components/actividad/VistaActividad.tsx';

const ejercicio = (id, nivel) => ({
  id,
  materia: 'matematicas',
  nivel_dificultad: nivel,
  contenido: {
    tipo: TIPO_OPCION_MULTIPLE,
    enunciado: '¿Cuánto es 2 + 3?',
    opciones: { A: '5', B: '4', C: '6', D: '3' },
  },
});

// ----------------------------------------------------------------
// Validacion del ejercicio
// ----------------------------------------------------------------

test('acepta la semilla real de 0002', () => {
  const r = validarEjercicio(ejercicio('e1', 1));
  assert.equal(r.valido, true);
  assert.equal(r.ejercicio.nivel_dificultad, 1);
  assert.deepEqual(Object.keys(r.ejercicio.contenido.opciones), ['A', 'B', 'C', 'D']);
});

test('rechaza un ejercicio cuyo contenido publico incluya la respuesta correcta', () => {
  // Defensa en profundidad: la respuesta vive en ejercicios_respuestas,
  // tabla inaccesible para authenticated. Si alguien la incrustara en el
  // contenido publico, el ejercicio se descarta en vez de filtrarla.
  for (const clave of ['respuesta_correcta', 'respuesta', 'solucion', 'CORRECTA']) {
    const malo = ejercicio('e1', 1);
    malo.contenido[clave] = 'A';
    const r = validarEjercicio(malo);
    assert.equal(r.valido, false, `debe rechazar la clave ${clave}`);
    assert.equal(r.motivo, 'contenido_expone_respuesta');
  }
});

test('rechaza niveles fuera de 1-5 y no enteros', () => {
  for (const nivel of [0, 6, -1, 2.5, '3', null]) {
    assert.equal(validarEjercicio(ejercicio('e1', nivel)).valido, false, `nivel ${nivel}`);
  }
});

test('rechaza un tipo no soportado en vez de dibujarlo a medias', () => {
  const malo = ejercicio('e1', 1);
  malo.contenido.tipo = 'texto_libre';
  assert.equal(validarEjercicio(malo).motivo, 'tipo_no_soportado');
});

test('rechaza opciones vacias, insuficientes o no textuales', () => {
  const sinTexto = ejercicio('e1', 1);
  sinTexto.contenido.opciones = { A: '', B: 'x' };
  assert.equal(validarEjercicio(sinTexto).motivo, 'opciones_invalidas');

  const unaSola = ejercicio('e1', 1);
  unaSola.contenido.opciones = { A: '5' };
  assert.equal(validarEjercicio(unaSola).motivo, 'opciones_insuficientes');

  const noTexto = ejercicio('e1', 1);
  noTexto.contenido.opciones = { A: 5, B: 4 };
  assert.equal(validarEjercicio(noTexto).motivo, 'opciones_invalidas');
});

test('rechaza formas que no son objeto', () => {
  for (const valor of [null, [], 'x', 7]) {
    assert.equal(validarEjercicio(valor).valido, false);
  }
});

// ----------------------------------------------------------------
// Seleccion por nivel
// ----------------------------------------------------------------

test('selecciona el ejercicio del nivel exacto cuando existe', () => {
  const r = seleccionarEjercicio([ejercicio('a', 1), ejercicio('b', 3), ejercicio('c', 5)], 3);
  assert.equal(r.estado, 'elegido');
  assert.equal(r.ejercicio.id, 'b');
  assert.equal(r.exacto, true);
});

test('selecciona el nivel mas cercano cuando el exacto no existe', () => {
  const r = seleccionarEjercicio([ejercicio('a', 1), ejercicio('b', 5)], 4);
  assert.equal(r.ejercicio.id, 'b');
  assert.equal(r.exacto, false);
});

test('ante empate de distancia elige el nivel MAS BAJO', () => {
  // Empezar por lo mas facil permite avanzar; empezar por lo mas dificil
  // puede frenar en seco a quien acaba de llegar.
  const r = seleccionarEjercicio([ejercicio('alto', 4), ejercicio('bajo', 2)], 3);
  assert.equal(r.ejercicio.id, 'bajo');
  assert.equal(r.exacto, false);
});

test('la seleccion es determinista ante dos ejercicios del mismo nivel', () => {
  const entrada = [ejercicio('zzz', 2), ejercicio('aaa', 2)];
  const primera = seleccionarEjercicio(entrada, 2).ejercicio.id;
  const segunda = seleccionarEjercicio([...entrada].reverse(), 2).ejercicio.id;
  assert.equal(primera, 'aaa');
  assert.equal(segunda, 'aaa');
});

test('la seleccion no muta el arreglo recibido', () => {
  const entrada = [ejercicio('b', 5), ejercicio('a', 1)];
  seleccionarEjercicio(entrada, 1);
  assert.equal(entrada[0].id, 'b');
});

test('sin ejercicios devuelve un estado propio, no un error ni null', () => {
  assert.equal(seleccionarEjercicio([], 3).estado, 'sin_ejercicios');
});

// ----------------------------------------------------------------
// Regla adaptativa
// ----------------------------------------------------------------

test('acertar sube un nivel; fallar baja un nivel', () => {
  assert.equal(calcularNivelSiguiente(3, true), 4);
  assert.equal(calcularNivelSiguiente(3, false), 2);
});

test('el nivel siguiente nunca sale de 1-5', () => {
  assert.equal(calcularNivelSiguiente(NIVEL_MAXIMO, true), NIVEL_MAXIMO);
  assert.equal(calcularNivelSiguiente(NIVEL_MINIMO, false), NIVEL_MINIMO);
  for (let nivel = NIVEL_MINIMO; nivel <= NIVEL_MAXIMO; nivel++) {
    for (const correcto of [true, false]) {
      const siguiente = calcularNivelSiguiente(nivel, correcto);
      assert.ok(siguiente >= NIVEL_MINIMO && siguiente <= NIVEL_MAXIMO, `${nivel}/${correcto}`);
    }
  }
});

// ----------------------------------------------------------------
// Progreso reconstruible
// ----------------------------------------------------------------

const intento = (ejercicioId, correcto, fecha) => ({
  id: `i-${fecha}`,
  ejercicio_id: ejercicioId,
  correcto,
  fecha,
});

test('sin intentos, el proximo nivel es el que sugirio Gemini', () => {
  const p = resumirProgreso([], [ejercicio('a', 1)], 4);
  assert.equal(p.completadas, 0);
  assert.equal(p.aciertos, 0);
  assert.equal(p.ultimoCorrecto, null);
  assert.equal(p.nivelProximoRecomendado, 4);
  assert.equal(p.nivelInicialSugerido, 4);
});

test('el progreso se reconstruye desde lo persistido, sin columna nueva', () => {
  // Es exactamente lo que ocurre tras recargar: solo hay intentos y el
  // banco de ejercicios; el nivel realizado sale del cruce por id.
  const p = resumirProgreso(
    [intento('a', true, '2026-08-10T10:00:00Z')],
    [ejercicio('a', 2)],
    1
  );
  assert.equal(p.completadas, 1);
  assert.equal(p.aciertos, 1);
  assert.equal(p.ultimoCorrecto, true);
  assert.equal(p.nivelUltimoEjercicio, 2);
  assert.equal(p.nivelProximoRecomendado, 3);
  assert.equal(p.seMantiene, false);
});

test('el ultimo intento se determina por fecha, no por el orden de llegada', () => {
  const p = resumirProgreso(
    [
      intento('a', false, '2026-08-10T12:00:00Z'),
      intento('a', true, '2026-08-10T09:00:00Z'),
    ],
    [ejercicio('a', 3)],
    1
  );
  assert.equal(p.completadas, 2);
  assert.equal(p.aciertos, 1);
  assert.equal(p.ultimoCorrecto, false, 'el mas reciente es el fallido');
  assert.equal(p.nivelProximoRecomendado, 2);
});

test('en un limite de la escala se indica que el nivel se mantiene', () => {
  const p = resumirProgreso([intento('a', true, '2026-08-10T10:00:00Z')], [ejercicio('a', 5)], 5);
  assert.equal(p.nivelProximoRecomendado, 5);
  assert.equal(p.seMantiene, true);
});

test('un intento sobre un ejercicio ausente del banco no inventa un nivel', () => {
  const p = resumirProgreso([intento('desaparecido', true, '2026-08-10T10:00:00Z')], [ejercicio('a', 2)], 3);
  assert.equal(p.nivelUltimoEjercicio, null);
  assert.equal(p.nivelProximoRecomendado, 3, 'cae al nivel del perfil, no a un valor inventado');
});

// ----------------------------------------------------------------
// Resultado de la RPC
// ----------------------------------------------------------------

test('el resultado correcto/incorrecto sale de la RPC, no del cliente', () => {
  assert.deepEqual(interpretarResultadoIntento({ data: [{ es_correcto: true }], error: null }), {
    estado: 'registrado',
    correcto: true,
  });
  assert.deepEqual(interpretarResultadoIntento({ data: [{ es_correcto: false }], error: null }), {
    estado: 'registrado',
    correcto: false,
  });
});

test('sin evidencia positiva de la fila no se declara exito', () => {
  const casos = [
    { data: [], error: null },
    { data: null, error: null },
    { data: [{}], error: null },
    { data: [{ es_correcto: 'si' }], error: null },
    { data: [{ es_correcto: true }], error: { message: 'x' } },
  ];
  for (const caso of casos) {
    assert.equal(interpretarResultadoIntento(caso).estado, 'no_registrado', JSON.stringify(caso));
  }
});

// ----------------------------------------------------------------
// Adaptacion por estilo
// ----------------------------------------------------------------

test('cada estilo tiene su frase de orientacion y ninguna se repite', () => {
  const frases = ESTILOS_APRENDIZAJE.map((e) => orientacionParaEstilo(e));
  for (const frase of frases) {
    assert.equal(typeof frase, 'string');
    assert.ok(frase.trim().length > 0);
  }
  assert.equal(new Set(frases).size, ESTILOS_APRENDIZAJE.length);
});

// ----------------------------------------------------------------
// Propiedades observables solo en el codigo fuente
// ----------------------------------------------------------------

test('[ESTATICA] el cliente nunca consulta ejercicios_respuestas', () => {
  const fuente = readFileSync(path.join(RAIZ, RUTA_VISTA), 'utf8');
  const sinComentarios = fuente.replace(/\/\/.*$/gm, '');
  assert.ok(
    !/from\(['"]ejercicios_respuestas['"]\)/.test(sinComentarios),
    'la respuesta oficial no puede pedirse desde el navegador'
  );
  // Y las columnas de ejercicios se piden por nombre, no con "*".
  assert.ok(/select\('id,materia,nivel_dificultad,contenido'\)/.test(fuente));
  assert.ok(!/from\('ejercicios'\)\.select\('\*'\)/.test(fuente));
});

test('[ESTATICA] a la RPC solo se envian los parametros admitidos', () => {
  const fuente = readFileSync(path.join(RAIZ, RUTA_VISTA), 'utf8');
  const llamada = fuente.slice(fuente.indexOf("rpc('registrar_intento'"));
  const bloque = llamada.slice(0, llamada.indexOf('}'));
  for (const permitido of ['p_ejercicio_id', 'p_respuesta_dada', 'p_tiempo_respuesta']) {
    assert.ok(bloque.includes(permitido), `falta ${permitido}`);
  }
  // Ni el veredicto ni la identidad pueden venir del navegador.
  for (const prohibido of ['correcto', 'usuario_id', 'p_correcto', 'p_usuario_id']) {
    assert.ok(!bloque.includes(prohibido), `no debe enviarse ${prohibido}`);
  }
});

test('[ESTATICA] la RPC se invoca una sola vez y protegida contra doble envio', () => {
  const fuente = readFileSync(path.join(RAIZ, RUTA_VISTA), 'utf8');
  const invocaciones = fuente.match(/rpc\(['"]registrar_intento['"]/g) ?? [];
  assert.equal(invocaciones.length, 1, 'debe existir un unico punto de invocacion');

  // Guardia de entrada: se sale si el estado no es 'respondiendo', de
  // modo que ni un doble clic ni un envio tras completar pasan.
  assert.ok(/if \(estado !== 'respondiendo'\) return;/.test(fuente));
  // Y el boton queda deshabilitado mientras la peticion esta en vuelo.
  assert.ok(/disabled=\{enviando \|\| opcionElegida === null\}/.test(fuente));
});

test('[ESTATICA] sin perfil se redirige a /diagnostico', () => {
  const fuente = readFileSync(path.join(RAIZ, RUTA_VISTA), 'utf8');
  assert.ok(/consulta\.estado !== 'con_perfil'/.test(fuente));
  assert.ok(/'\/diagnostico'/.test(fuente));
  assert.ok(/router\.replace\(/.test(fuente));
});

test('[ESTATICA] al recargar con un intento previo se muestra el resultado, no el formulario', () => {
  const fuente = readFileSync(path.join(RAIZ, RUTA_VISTA), 'utf8');
  assert.ok(/yaIntentado/.test(fuente));
  assert.ok(/setEstado\('completada'\)/.test(fuente));
});

test('[ESTATICA] /perfil ofrece el CTA de la actividad', () => {
  const fuente = readFileSync(path.join(RAIZ, 'src/components/diagnostico/TarjetaPerfil.tsx'), 'utf8');
  assert.ok(fuente.includes('href="/actividad"'));
  assert.ok(fuente.includes('Iniciar actividad'));
});
