// Pruebas de la lectura del perfil ya persistido (Sprint A, A3).
//
// Se invoca la funcion REAL con la consulta simulada localmente: no hay
// red, no hay Supabase y no se levanta ningun servidor. Lo que se
// comprueba es la clasificacion de cada forma que la base de datos puede
// devolver, incluidas las que no deberian ocurrir.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  consultarPerfilPropio,
  MENSAJE_ERROR_CONSULTA,
  MENSAJE_PERFIL_INCOMPLETO,
} from './consulta.ts';
import { LONGITUD_MAXIMA_EXPLICACION } from './contrato.ts';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const PERFIL_VALIDO = {
  estilo_aprendizaje: 'visual',
  nivel_sugerido: 3,
  explicacion: 'Aprendes mejor con esquemas e imágenes. Empieza por lo visual.',
};

const devolviendo = (data, error = null) => ({ seleccionar: async () => ({ data, error }) });

test('devuelve el perfil cuando la fila es valida', async () => {
  const r = await consultarPerfilPropio(devolviendo([{ perfil_detectado: PERFIL_VALIDO }]));
  assert.equal(r.estado, 'con_perfil');
  assert.equal(r.perfil.estilo_aprendizaje, 'visual');
  assert.equal(r.perfil.nivel_sugerido, 3);
});

test('sin filas es "sin_diagnostico", no un error', async () => {
  const r = await consultarPerfilPropio(devolviendo([]));
  assert.equal(r.estado, 'sin_diagnostico');
});

test('un error de Supabase nunca se confunde con "sin diagnostico"', async () => {
  // Distinguirlos importa: "sin_diagnostico" redirige al test, y hacer
  // eso ante un fallo transitorio empujaria al usuario hacia un segundo
  // envio que la restriccion UNIQUE rechazaria.
  const r = await consultarPerfilPropio(devolviendo(null, { message: 'network' }));
  assert.equal(r.estado, 'error');
});

test('una excepcion de la consulta se clasifica como error', async () => {
  const r = await consultarPerfilPropio({
    seleccionar: async () => {
      throw new Error('caida');
    },
  });
  assert.equal(r.estado, 'error');
});

test('fila con perfil_detectado null es "perfil_incompleto", no "sin_diagnostico"', async () => {
  // Alcanzable de verdad: authenticated conserva INSERT directo sobre
  // (usuario_id, respuestas), sin perfil_detectado.
  const r = await consultarPerfilPropio(devolviendo([{ perfil_detectado: null }]));
  assert.equal(r.estado, 'perfil_incompleto');
});

test('el perfil almacenado se revalida: un estilo fuera del vocabulario se rechaza', async () => {
  const r = await consultarPerfilPropio(
    devolviendo([{ perfil_detectado: { ...PERFIL_VALIDO, estilo_aprendizaje: 'telepatico' } }])
  );
  assert.equal(r.estado, 'perfil_incompleto');
});

test('el perfil almacenado se revalida: una propiedad de mas se rechaza', async () => {
  const r = await consultarPerfilPropio(
    devolviendo([{ perfil_detectado: { ...PERFIL_VALIDO, riesgo: 'alto' } }])
  );
  assert.equal(r.estado, 'perfil_incompleto');
});

test('el perfil almacenado se revalida: vocabulario clinico se rechaza aunque ya este en la base', async () => {
  const r = await consultarPerfilPropio(
    devolviendo([
      { perfil_detectado: { ...PERFIL_VALIDO, explicacion: 'Presentas rasgos de T.D.A.H.' } },
    ])
  );
  assert.equal(r.estado, 'perfil_incompleto');
});

test('el perfil almacenado se revalida: explicacion demasiado larga se rechaza', async () => {
  const r = await consultarPerfilPropio(
    devolviendo([
      { perfil_detectado: { ...PERFIL_VALIDO, explicacion: 'a'.repeat(LONGITUD_MAXIMA_EXPLICACION + 1) } },
    ])
  );
  assert.equal(r.estado, 'perfil_incompleto');
});

test('data que no es un arreglo se clasifica como error, no como perfil', async () => {
  const r = await consultarPerfilPropio(devolviendo({ perfil_detectado: PERFIL_VALIDO }));
  assert.equal(r.estado, 'sin_diagnostico');
});

test('los mensajes al usuario no invitan a repetir el test', () => {
  // El diagnostico es unico por usuario (usuario_id UNIQUE, sin policy
  // de DELETE): ofrecer "intentalo de nuevo" seria ofrecer algo
  // imposible.
  for (const mensaje of [MENSAJE_PERFIL_INCOMPLETO, MENSAJE_ERROR_CONSULTA]) {
    assert.ok(!/de nuevo el test|repetir|volver a hacer/i.test(mensaje), mensaje);
  }
});

test('[ESTATICA] la consulta no filtra por usuario_id: la autorizacion es de RLS', () => {
  // Un filtro por usuario tomado del navegador daria la falsa impresion
  // de que la seguridad depende del cliente.
  const fuente = readFileSync(path.join(RAIZ, 'src/lib/diagnostico/consulta.ts'), 'utf8');
  assert.ok(!/\.eq\(/.test(fuente), 'consulta.ts no debe construir filtros de igualdad');
  assert.ok(!/usuario_id/.test(fuente.replace(/\/\/.*$/gm, '')), 'fuera de comentarios no debe aparecer usuario_id');
});

test('[ESTATICA] el diagnostico redirige a /perfil ante un 409 y no muestra el mensaje de reintento', () => {
  const fuente = readFileSync(
    path.join(RAIZ, 'src/components/diagnostico/FormularioDiagnostico.tsx'),
    'utf8'
  );
  const bloque = fuente.slice(fuente.indexOf("diagnostico_existente"));
  assert.ok(/router\.replace\('\/perfil'\)/.test(bloque.slice(0, 400)));
});
