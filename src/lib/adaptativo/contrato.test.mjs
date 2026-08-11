// Pruebas del contrato del analisis adaptativo (Dia 3 -- ciclo completo).
//
// Todo con datos locales: no hay red, no hay Supabase, no se escribe en
// ninguna tabla y no se levanta ningun servidor.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validarAnalisisAdaptativo,
  CLAVES_ANALISIS,
  MATERIAS,
  NIVELES_CONFIANZA,
  NIVEL_MINIMO,
  NIVEL_MAXIMO,
  MAXIMO_ELEMENTOS_LISTA,
  LONGITUD_MAXIMA_ELEMENTO,
  LONGITUD_MAXIMA_FRASE,
  LONGITUD_MAXIMA_JUSTIFICACION,
} from './contrato.ts';
import { RAICES_CLINICAS_PROHIBIDAS } from '../diagnostico/contrato.ts';
import { analisisValido } from './ejemplo.test-util.mjs';

// ----------------------------------------------------------------
// 1. Validacion del JSON de Gemini -- caso positivo
// ----------------------------------------------------------------

test('acepta un analisis completo y bien formado', () => {
  const r = validarAnalisisAdaptativo(analisisValido());
  assert.equal(r.valido, true);
  assert.equal(r.analisis.nivel_recomendado, 2);
  assert.equal(r.analisis.confianza, 'baja');
  assert.deepEqual(Object.keys(r.analisis).sort(), [...CLAVES_ANALISIS].sort());
});

test('el analisis cubre los ocho puntos exigidos al ciclo', () => {
  // Comprobacion de cobertura, no de implementacion: si alguien quitara
  // una clave, esta prueba dice exactamente que punto del ciclo queda sin
  // representar.
  const cobertura = {
    'fortalezas observadas': 'fortalezas',
    'dificultades educativas observadas': 'dificultades',
    'habilidad prioritaria': 'habilidad_prioritaria',
    'nivel o dificultad recomendada': 'nivel_recomendado',
    'apoyo pedagogico recomendado': 'apoyo_pedagogico',
    'siguiente actividad (materia)': 'siguiente_actividad_materia',
    'siguiente actividad (enfoque)': 'siguiente_actividad_enfoque',
    'justificacion basada en evidencias': 'justificacion',
    'grado de confianza': 'confianza',
  };
  for (const [punto, clave] of Object.entries(cobertura)) {
    assert.ok(CLAVES_ANALISIS.includes(clave), `sin clave para "${punto}"`);
  }
});

test('los textos se devuelven recortados, nunca reescritos', () => {
  const r = validarAnalisisAdaptativo(
    analisisValido({ habilidad_prioritaria: '   Sumas con reagrupación   ' })
  );
  assert.equal(r.valido, true);
  assert.equal(r.analisis.habilidad_prioritaria, 'Sumas con reagrupación');
});

// ----------------------------------------------------------------
// 2. Rechazo de resultados incompletos o invalidos
// ----------------------------------------------------------------

test('rechaza cualquier analisis al que le falte una sola clave', () => {
  for (const clave of CLAVES_ANALISIS) {
    const incompleto = analisisValido();
    delete incompleto[clave];
    const r = validarAnalisisAdaptativo(incompleto);
    assert.equal(r.valido, false, `deberia rechazar sin "${clave}"`);
    assert.equal(r.motivo, 'clave_faltante');
  }
});

test('rechaza un analisis con una propiedad de mas', () => {
  const r = validarAnalisisAdaptativo(analisisValido({ probabilidad_asperger: 0.8 }));
  assert.equal(r.valido, false);
  assert.equal(r.motivo, 'propiedad_no_autorizada');
});

test('rechaza lo que no es un objeto', () => {
  for (const valor of [null, undefined, 'texto', 42, true, [], [analisisValido()]]) {
    const r = validarAnalisisAdaptativo(valor);
    assert.equal(r.valido, false);
    assert.equal(r.motivo, 'no_es_objeto');
  }
});

test('rechaza listas vacias, demasiado largas o con elementos no textuales', () => {
  for (const clave of ['fortalezas', 'dificultades']) {
    assert.equal(validarAnalisisAdaptativo(analisisValido({ [clave]: [] })).motivo, 'lista_invalida');
    assert.equal(
      validarAnalisisAdaptativo(analisisValido({ [clave]: Array(MAXIMO_ELEMENTOS_LISTA + 1).fill('x') }))
        .motivo,
      'lista_invalida'
    );
    assert.equal(
      validarAnalisisAdaptativo(analisisValido({ [clave]: ['ok', 7] })).motivo,
      'lista_invalida'
    );
    assert.equal(
      validarAnalisisAdaptativo(analisisValido({ [clave]: ['   '] })).motivo,
      'lista_invalida'
    );
    assert.equal(
      validarAnalisisAdaptativo(analisisValido({ [clave]: 'no es lista' })).motivo,
      'lista_invalida'
    );
  }
});

test('rechaza niveles fuera de rango, decimales o no numericos', () => {
  for (const nivel of [0, 6, -1, 2.5, '2', null, NaN]) {
    const r = validarAnalisisAdaptativo(analisisValido({ nivel_recomendado: nivel }));
    assert.equal(r.valido, false, `deberia rechazar nivel ${String(nivel)}`);
    assert.equal(r.motivo, 'nivel_invalido');
  }
  for (let nivel = NIVEL_MINIMO; nivel <= NIVEL_MAXIMO; nivel += 1) {
    assert.equal(validarAnalisisAdaptativo(analisisValido({ nivel_recomendado: nivel })).valido, true);
  }
});

test('rechaza materias fuera del CHECK de public.ejercicios', () => {
  for (const materia of ['ciencias', 'MATEMATICAS', '', null, 3]) {
    const r = validarAnalisisAdaptativo(analisisValido({ siguiente_actividad_materia: materia }));
    assert.equal(r.valido, false);
    assert.equal(r.motivo, 'materia_invalida');
  }
  for (const materia of MATERIAS) {
    assert.equal(
      validarAnalisisAdaptativo(analisisValido({ siguiente_actividad_materia: materia })).valido,
      true
    );
  }
});

test('rechaza grados de confianza fuera del vocabulario cerrado', () => {
  for (const confianza of ['altisima', '0.9', 90, null, 'Alta']) {
    const r = validarAnalisisAdaptativo(analisisValido({ confianza }));
    assert.equal(r.valido, false);
    assert.equal(r.motivo, 'confianza_invalida');
  }
  for (const confianza of NIVELES_CONFIANZA) {
    assert.equal(validarAnalisisAdaptativo(analisisValido({ confianza })).valido, true);
  }
});

test('rechaza textos vacios y textos que superan su limite', () => {
  const limites = {
    habilidad_prioritaria: LONGITUD_MAXIMA_ELEMENTO,
    apoyo_pedagogico: LONGITUD_MAXIMA_FRASE,
    siguiente_actividad_enfoque: LONGITUD_MAXIMA_FRASE,
    justificacion: LONGITUD_MAXIMA_JUSTIFICACION,
  };
  for (const [clave, maximo] of Object.entries(limites)) {
    assert.equal(validarAnalisisAdaptativo(analisisValido({ [clave]: '' })).motivo, 'texto_invalido');
    assert.equal(validarAnalisisAdaptativo(analisisValido({ [clave]: '  ' })).motivo, 'texto_invalido');
    assert.equal(validarAnalisisAdaptativo(analisisValido({ [clave]: 5 })).motivo, 'texto_invalido');
    assert.equal(
      validarAnalisisAdaptativo(analisisValido({ [clave]: 'a'.repeat(maximo + 1) })).motivo,
      'texto_invalido'
    );
    assert.equal(
      validarAnalisisAdaptativo(analisisValido({ [clave]: 'a'.repeat(maximo) })).valido,
      true
    );
  }
});

// ----------------------------------------------------------------
// 3. Barrera clinica: el perfil debe ser educativo, nunca clinico
// ----------------------------------------------------------------

test('rechaza vocabulario clinico en CUALQUIERA de los campos de texto', () => {
  const campos = [
    ['fortalezas', (t) => ({ fortalezas: [t] })],
    ['dificultades', (t) => ({ dificultades: [t] })],
    ['habilidad_prioritaria', (t) => ({ habilidad_prioritaria: t })],
    ['apoyo_pedagogico', (t) => ({ apoyo_pedagogico: t })],
    ['siguiente_actividad_enfoque', (t) => ({ siguiente_actividad_enfoque: t })],
    ['justificacion', (t) => ({ justificacion: t })],
  ];
  for (const [nombre, construir] of campos) {
    const r = validarAnalisisAdaptativo(analisisValido(construir('Presenta un trastorno de atención')));
    assert.equal(r.valido, false, `${nombre} deberia rechazarse`);
    assert.equal(r.motivo, 'vocabulario_prohibido');
  }
});

test('la barrera clinica cubre todas las raices, tambien con tildes y separadores', () => {
  for (const raiz of RAICES_CLINICAS_PROHIBIDAS) {
    const r = validarAnalisisAdaptativo(analisisValido({ justificacion: `Observo ${raiz} aquí.` }));
    assert.equal(r.valido, false, `no se detecto la raiz "${raiz}"`);
  }
  // Unicode descompuesto: "clínico" con U+0301 se ve identico pero es
  // otra secuencia de caracteres.
  const descompuesto = 'Es un diagnóstico clínico claro.';
  assert.equal(validarAnalisisAdaptativo(analisisValido({ justificacion: descompuesto })).motivo, 'vocabulario_prohibido');
  // Separadores evasivos.
  assert.equal(validarAnalisisAdaptativo(analisisValido({ justificacion: 'Rasgos de T.D.A.H.' })).motivo, 'vocabulario_prohibido');
});

test('un texto educativo normal no dispara la barrera', () => {
  const r = validarAnalisisAdaptativo(
    analisisValido({
      justificacion: 'Fallaste la resta de nivel 2 en 40 segundos: conviene volver al nivel 1.',
    })
  );
  assert.equal(r.valido, true);
});
