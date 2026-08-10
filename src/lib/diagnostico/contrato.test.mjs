// Pruebas del recorrido de diagnostico y perfil (Dia 3).
//
// Todas las pruebas de comportamiento invocan las funciones REALES con
// dependencias simuladas localmente. No hay red, no hay clave de Gemini,
// no hay Supabase y no se levanta ningun servidor. Las unicas
// comprobaciones que leen archivos como texto son las tres finales, que
// verifican una propiedad que solo puede observarse en el codigo fuente
// (que el secreto no se importe desde un componente de cliente); se
// declaran como tales y no sustituyen a ninguna prueba conductual.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PREGUNTAS, CANTIDAD_PREGUNTAS, ESTILOS_APRENDIZAJE } from './preguntas.ts';
import {
  validarRespuestasDiagnostico,
  validarPerfilDetectado,
  contieneVocabularioProhibido,
  canonizarParaComparar,
  CLAVES_PERFIL,
  LONGITUD_MAXIMA_EXPLICACION,
  MENSAJE_ERROR_PERFIL,
  RAICES_CLINICAS_PROHIBIDAS,
} from './contrato.ts';
import {
  construirInstruccion,
  generarPerfil,
  interpretarTextoPerfil,
  ESQUEMA_PERFIL,
} from '../gemini/perfil.ts';
import {
  extraerTokenBearer,
  verificarUsuario,
  interpretarResultadoPersistencia,
} from '../supabase/servidor.ts';
import { extraerTextoDeRespuesta } from '../gemini/cliente.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '../../..');

// Conjunto valido de referencia, construido a partir del banco real:
// siempre se elige la primera opcion de cada pregunta.
function respuestasValidas() {
  const respuestas = {};
  for (const pregunta of PREGUNTAS) respuestas[pregunta.id] = pregunta.opciones[0].id;
  return respuestas;
}

const PERFIL_VALIDO = {
  estilo_aprendizaje: 'visual',
  nivel_sugerido: 3,
  explicacion: 'Aprendes mejor con imágenes y esquemas. Conviene empezar por ejercicios de nivel medio.',
};

// ============================================================
// 1 y 2: el banco de preguntas
// ============================================================

test('el banco contiene exactamente 12 preguntas', () => {
  assert.equal(PREGUNTAS.length, 12);
  assert.equal(CANTIDAD_PREGUNTAS, 12);
});

test('los identificadores de pregunta son unicos', () => {
  const ids = PREGUNTAS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'no debe haber identificadores repetidos');
});

test('cada pregunta tiene al menos dos opciones con identificadores unicos y texto no vacio', () => {
  for (const pregunta of PREGUNTAS) {
    assert.ok(pregunta.opciones.length >= 2, `${pregunta.id} debe ofrecer al menos dos opciones`);
    const ids = pregunta.opciones.map((o) => o.id);
    assert.equal(new Set(ids).size, ids.length, `${pregunta.id} tiene opciones con id repetido`);
    for (const opcion of pregunta.opciones) {
      assert.ok(opcion.texto.trim().length > 0, `${pregunta.id}/${opcion.id} no puede tener texto vacio`);
    }
    assert.ok(pregunta.enunciado.trim().length > 0);
  }
});

test('el banco respeta el CHECK de la base de datos: 12 claves, dentro del rango 10-15 permitido', () => {
  // es_respuestas_diagnostico_valido() en 0001 exige entre 10 y 15 claves.
  assert.ok(CANTIDAD_PREGUNTAS >= 10 && CANTIDAD_PREGUNTAS <= 15);
});

test('ninguna pregunta usa vocabulario clinico ni pide datos personales', () => {
  const prohibido = [
    'asperger', 'autis', 'tdah', 'trastorno', 'sindrome', 'síndrome', 'discapacidad',
    'diagnostic', 'diagnóstic', 'terapia', 'medicac', 'psicolog', 'psiquiatr',
    'nombre completo', 'apellido', 'documento', 'cedula', 'cédula', 'telefono',
    'teléfono', 'correo', 'email', 'direccion', 'dirección', 'familia',
  ];
  for (const pregunta of PREGUNTAS) {
    const texto = [pregunta.enunciado, ...pregunta.opciones.map((o) => o.texto)].join(' ').toLowerCase();
    for (const termino of prohibido) {
      assert.ok(!texto.includes(termino), `${pregunta.id} no debe contener "${termino}"`);
    }
  }
});

// ============================================================
// 3 y 4: validacion de respuestas
// ============================================================

test('respuestas validas y completas son aceptadas', () => {
  const resultado = validarRespuestasDiagnostico(respuestasValidas());
  assert.equal(resultado.valido, true);
  assert.equal(Object.keys(resultado.respuestas).length, 12);
});

test('faltan respuestas -> rechazado por cantidad incorrecta', () => {
  const incompletas = respuestasValidas();
  delete incompletas.p12;
  const resultado = validarRespuestasDiagnostico(incompletas);
  assert.equal(resultado.valido, false);
  assert.equal(resultado.motivo, 'cantidad_incorrecta');
});

test('sobran respuestas (pregunta desconocida ademas de las 12) -> rechazado', () => {
  const conExtra = { ...respuestasValidas(), p99: 'A' };
  const resultado = validarRespuestasDiagnostico(conExtra);
  assert.equal(resultado.valido, false);
  assert.equal(resultado.motivo, 'cantidad_incorrecta');
});

test('un identificador de pregunta desconocido, manteniendo 12 claves -> rechazado', () => {
  const respuestas = respuestasValidas();
  delete respuestas.p12;
  respuestas.pregunta_inventada = 'A';
  const resultado = validarRespuestasDiagnostico(respuestas);
  assert.equal(resultado.valido, false);
  assert.equal(resultado.motivo, 'pregunta_desconocida');
});

test('una opcion que no pertenece a esa pregunta -> rechazado', () => {
  const respuestas = respuestasValidas();
  respuestas.p1 = 'Z';
  const resultado = validarRespuestasDiagnostico(respuestas);
  assert.equal(resultado.valido, false);
  assert.equal(resultado.motivo, 'opcion_desconocida');
});

test('texto libre enviado por el navegador en lugar de una opcion -> rechazado', () => {
  const respuestas = respuestasValidas();
  respuestas.p3 = 'lo que yo quiera escribir aqui';
  const resultado = validarRespuestasDiagnostico(respuestas);
  assert.equal(resultado.valido, false);
  assert.equal(resultado.motivo, 'opcion_desconocida');
});

test('valores que no son texto (numero, objeto, null) -> rechazados', () => {
  for (const valorInvalido of [3, { a: 1 }, null, true]) {
    const respuestas = respuestasValidas();
    respuestas.p5 = valorInvalido;
    const resultado = validarRespuestasDiagnostico(respuestas);
    assert.equal(resultado.valido, false, `${JSON.stringify(valorInvalido)} debe rechazarse`);
  }
});

test('un arreglo, un escalar o null en lugar del objeto de respuestas -> rechazado', () => {
  for (const valorInvalido of [[], 'texto', 42, null, undefined]) {
    const resultado = validarRespuestasDiagnostico(valorInvalido);
    assert.equal(resultado.valido, false);
  }
});

// ============================================================
// 5, 6, 7 y 8: validacion del perfil
// ============================================================

test('un perfil estructurado valido es aceptado y normalizado', () => {
  const resultado = validarPerfilDetectado({ ...PERFIL_VALIDO, explicacion: `  ${PERFIL_VALIDO.explicacion}  ` });
  assert.equal(resultado.valido, true);
  assert.equal(resultado.perfil.estilo_aprendizaje, 'visual');
  assert.equal(resultado.perfil.nivel_sugerido, 3);
  assert.equal(resultado.perfil.explicacion, PERFIL_VALIDO.explicacion);
});

test('los cuatro estilos del vocabulario permitido son aceptados', () => {
  for (const estilo of ESTILOS_APRENDIZAJE) {
    const resultado = validarPerfilDetectado({ ...PERFIL_VALIDO, estilo_aprendizaje: estilo });
    assert.equal(resultado.valido, true, `${estilo} debe aceptarse`);
  }
});

test('un perfil incompleto (falta una clave obligatoria) -> rechazado', () => {
  for (const clave of CLAVES_PERFIL) {
    const perfil = { ...PERFIL_VALIDO };
    delete perfil[clave];
    const resultado = validarPerfilDetectado(perfil);
    assert.equal(resultado.valido, false, `sin "${clave}" debe rechazarse`);
  }
});

test('una propiedad no autorizada en el perfil -> rechazada, no ignorada', () => {
  const resultado = validarPerfilDetectado({ ...PERFIL_VALIDO, probabilidad_asperger: 0.8 });
  assert.equal(resultado.valido, false);
  assert.equal(resultado.motivo, 'propiedad_no_autorizada');
});

test('un estilo fuera del vocabulario permitido -> rechazado', () => {
  for (const estilo of ['clinico', 'asperger', 'VISUAL', '', 'otro']) {
    const resultado = validarPerfilDetectado({ ...PERFIL_VALIDO, estilo_aprendizaje: estilo });
    assert.equal(resultado.valido, false, `"${estilo}" debe rechazarse`);
    assert.equal(resultado.motivo, 'estilo_invalido');
  }
});

test('un nivel fuera de rango, decimal o no numerico -> rechazado', () => {
  for (const nivel of [0, 6, -1, 2.5, '3', null, NaN]) {
    const resultado = validarPerfilDetectado({ ...PERFIL_VALIDO, nivel_sugerido: nivel });
    assert.equal(resultado.valido, false, `${String(nivel)} debe rechazarse`);
    assert.equal(resultado.motivo, 'nivel_invalido');
  }
});

test('una explicacion vacia, no textual o demasiado larga -> rechazada', () => {
  const demasiadoLarga = 'a'.repeat(LONGITUD_MAXIMA_EXPLICACION + 1);
  for (const explicacion of ['', '   ', 123, null, demasiadoLarga]) {
    const resultado = validarPerfilDetectado({ ...PERFIL_VALIDO, explicacion });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, 'explicacion_invalida');
  }
});

test('un resultado con lenguaje clinico en la explicacion -> rechazado entero, no recortado', () => {
  const clinicos = [
    'Presentas indicadores de Asperger y conviene una terapia de apoyo.',
    'Tu perfil sugiere un trastorno de atención.',
    'Se observa una posible dislexia en tus respuestas.',
    'Recomiendo evaluación psicológica.',
  ];
  for (const explicacion of clinicos) {
    const resultado = validarPerfilDetectado({ ...PERFIL_VALIDO, explicacion });
    assert.equal(resultado.valido, false, `"${explicacion}" debe rechazarse`);
    assert.equal(resultado.motivo, 'vocabulario_prohibido');
  }
});

test('un perfil que no es objeto (arreglo, texto, null) -> rechazado', () => {
  for (const valor of [[], 'visual', 3, null, undefined]) {
    const resultado = validarPerfilDetectado(valor);
    assert.equal(resultado.valido, false);
  }
});

// ============================================================
// Parseo de la respuesta del modelo
// ============================================================

test('interpretarTextoPerfil acepta un JSON valido conforme al contrato', () => {
  const resultado = interpretarTextoPerfil(JSON.stringify(PERFIL_VALIDO));
  assert.equal(resultado.estado, 'ok');
  assert.equal(resultado.perfil.nivel_sugerido, 3);
});

test('interpretarTextoPerfil rechaza JSON malformado sin lanzar excepcion', () => {
  for (const texto of ['{', '', 'no soy json', '{"estilo_aprendizaje":}']) {
    const resultado = interpretarTextoPerfil(texto);
    assert.equal(resultado.estado, 'error');
    assert.equal(resultado.categoria, 'respuesta_invalida');
  }
});

test('interpretarTextoPerfil NO rescata un objeto envuelto en texto (sin extraccion por regex)', () => {
  const envuelto = `Aquí tienes el perfil: ${JSON.stringify(PERFIL_VALIDO)} ¡Espero que ayude!`;
  const resultado = interpretarTextoPerfil(envuelto);
  assert.equal(resultado.estado, 'error', 'no debe intentarse recuperar JSON incrustado en prosa');
});

test('extraerTextoDeRespuesta navega la forma real de generateContent y devuelve null ante formas inesperadas', () => {
  const valida = { candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] };
  assert.equal(extraerTextoDeRespuesta(valida), '{"a":1}');
  for (const invalida of [null, {}, { candidates: [] }, { candidates: [{}] }, { candidates: [{ content: {} }] }]) {
    assert.equal(extraerTextoDeRespuesta(invalida), null);
  }
});

// ============================================================
// 10 y 12: generarPerfil con dependencias simuladas
// ============================================================

test('generarPerfil: respuesta valida del proveedor -> perfil valido', async () => {
  const resultado = await generarPerfil(respuestasValidas(), {
    llamar: async () => ({ estado: 'ok', texto: JSON.stringify(PERFIL_VALIDO) }),
  });
  assert.equal(resultado.estado, 'ok');
  assert.deepEqual(Object.keys(resultado.perfil).sort(), [...CLAVES_PERFIL].sort());
});

test('generarPerfil: un fallo del proveedor NO produce perfil, produce error de categoria fija', async () => {
  for (const categoria of ['configuracion', 'red', 'proveedor']) {
    const resultado = await generarPerfil(respuestasValidas(), {
      llamar: async () => ({ estado: 'error', categoria }),
    });
    assert.equal(resultado.estado, 'error');
    assert.equal(resultado.categoria, categoria);
    assert.equal(resultado.perfil, undefined, 'nunca debe inventarse un perfil ante un fallo');
  }
});

test('generarPerfil: contenido vacio del proveedor -> respuesta_invalida, nunca exito', async () => {
  const resultado = await generarPerfil(respuestasValidas(), {
    llamar: async () => ({ estado: 'error', categoria: 'respuesta_vacia' }),
  });
  assert.equal(resultado.estado, 'error');
  assert.equal(resultado.categoria, 'respuesta_invalida');
});

test('generarPerfil: el proveedor devuelve un perfil clinico -> se rechaza, no se persiste nada', async () => {
  const resultado = await generarPerfil(respuestasValidas(), {
    llamar: async () => ({
      estado: 'ok',
      texto: JSON.stringify({
        estilo_aprendizaje: 'visual',
        nivel_sugerido: 3,
        explicacion: 'Muestras rasgos compatibles con Asperger.',
      }),
    }),
  });
  assert.equal(resultado.estado, 'error');
  assert.equal(resultado.categoria, 'respuesta_invalida');
});

test('generarPerfil: el proveedor añade propiedades extra -> se rechaza el perfil completo', async () => {
  const resultado = await generarPerfil(respuestasValidas(), {
    llamar: async () => ({
      estado: 'ok',
      texto: JSON.stringify({ ...PERFIL_VALIDO, confianza: 0.91 }),
    }),
  });
  assert.equal(resultado.estado, 'error');
  assert.equal(resultado.categoria, 'respuesta_invalida');
});

test('generarPerfil envia al proveedor el esquema estructurado y una instruccion con las 12 respuestas', async () => {
  let peticionRecibida = null;
  await generarPerfil(respuestasValidas(), {
    llamar: async (peticion) => {
      peticionRecibida = peticion;
      return { estado: 'ok', texto: JSON.stringify(PERFIL_VALIDO) };
    },
  });
  assert.ok(peticionRecibida, 'debe llamarse al proveedor');
  assert.equal(peticionRecibida.esquema, ESQUEMA_PERFIL);
  for (const pregunta of PREGUNTAS) {
    assert.ok(peticionRecibida.instruccion.includes(pregunta.id), `la instruccion debe incluir ${pregunta.id}`);
  }
});

// ============================================================
// 11 (parte conductual): privacidad de lo que se envia al proveedor
// ============================================================

test('la instruccion enviada a Gemini no contiene datos personales ni identificadores internos', () => {
  const instruccion = construirInstruccion(respuestasValidas());
  const prohibido = [
    'usuario_id', 'user_id', 'uuid', '@', 'email', 'correo', 'nombre completo',
    'access_token', 'bearer', 'apikey', 'api_key', 'GEMINI_API_KEY',
  ];
  for (const termino of prohibido) {
    assert.ok(
      !instruccion.toLowerCase().includes(termino.toLowerCase()),
      `la instruccion no debe contener "${termino}"`
    );
  }
});

test('el esquema exigido al modelo admite exactamente las tres claves del contrato', () => {
  assert.deepEqual([...ESQUEMA_PERFIL.required].sort(), [...CLAVES_PERFIL].sort());
  assert.deepEqual(Object.keys(ESQUEMA_PERFIL.properties).sort(), [...CLAVES_PERFIL].sort());
});

// ============================================================
// 9: autenticacion verificada en servidor
// ============================================================

test('extraerTokenBearer acepta una cabecera Bearer valida y rechaza cualquier otra forma', () => {
  assert.equal(extraerTokenBearer('Bearer token-ficticio'), 'token-ficticio');
  assert.equal(extraerTokenBearer('bearer token-ficticio'), 'token-ficticio');
  for (const cabecera of [null, '', 'token-ficticio', 'Basic abc', 'Bearer', 'Bearer  ', 'Bearer a b']) {
    assert.equal(extraerTokenBearer(cabecera), null, `"${cabecera}" no debe producir token`);
  }
});

test('verificarUsuario: sin sesion valida NO se interpreta como usuario autenticado', async () => {
  const casosSinSesion = [
    { data: { user: null }, error: null },
    { data: { user: {} }, error: null },
    { data: { user: { id: '' } }, error: null },
    { data: { user: { id: 123 } }, error: null },
    { data: { user: { id: 'usuario-ficticio' } }, error: { message: 'invalid JWT' } },
  ];
  for (const respuesta of casosSinSesion) {
    const resultado = await verificarUsuario('token-ficticio', { getUser: async () => respuesta });
    assert.equal(resultado.estado, 'sin_sesion', `${JSON.stringify(respuesta)} no debe autenticar`);
  }
});

test('verificarUsuario: una excepcion del proveedor tampoco autentica', async () => {
  const resultado = await verificarUsuario('token-ficticio', {
    getUser: async () => {
      throw new Error('fetch failed');
    },
  });
  assert.equal(resultado.estado, 'sin_sesion');
});

test('verificarUsuario: token valido -> autenticado, y el id proviene del proveedor, no del cliente', async () => {
  let tokenRecibido = null;
  const resultado = await verificarUsuario('token-ficticio', {
    getUser: async (jwt) => {
      tokenRecibido = jwt;
      return { data: { user: { id: 'id-ficticio-del-proveedor' } }, error: null };
    },
  });
  assert.equal(tokenRecibido, 'token-ficticio');
  assert.equal(resultado.estado, 'autenticado');
  assert.equal(resultado.usuarioId, 'id-ficticio-del-proveedor');
});

// ============================================================
// 12: no se declara exito sin persistencia confirmada
// ============================================================

test('interpretarResultadoPersistencia: una fila devuelta -> persistido', () => {
  const resultado = interpretarResultadoPersistencia({
    data: [{ diagnostico_id: 'id-ficticio', fecha: '2026-08-07T00:00:00Z' }],
    error: null,
  });
  assert.equal(resultado, 'persistido');
});

test('interpretarResultadoPersistencia: sin error pero CERO filas -> NO persistido (no es exito silencioso)', () => {
  for (const data of [[], null, undefined, {}]) {
    assert.equal(interpretarResultadoPersistencia({ data, error: null }), 'no_persistido');
  }
});

test('interpretarResultadoPersistencia: diagnostico ya existente se distingue del fallo generico', () => {
  const resultado = interpretarResultadoPersistencia({
    data: null,
    error: { message: 'El usuario ya tiene un diagnostico registrado' },
  });
  assert.equal(resultado, 'diagnostico_existente');
});

test('interpretarResultadoPersistencia: cualquier otro error -> no_persistido', () => {
  for (const error of [{ message: 'permission denied' }, { message: '' }, {}, 'error']) {
    assert.equal(interpretarResultadoPersistencia({ data: null, error }), 'no_persistido');
  }
});

// ============================================================
// 11 (parte estructural): el secreto vive solo en el servidor.
//
// NOTA DE HONESTIDAD: las tres pruebas siguientes leen archivos fuente
// como texto. Es deliberado -- comprueban una propiedad de ARQUITECTURA
// (que ningun componente de cliente pueda alcanzar la clave) que no puede
// observarse invocando una funcion. No sustituyen a ninguna prueba
// conductual de las anteriores.
// ============================================================

test('GEMINI_API_KEY solo se lee en codigo de servidor, nunca en un componente de cliente', () => {
  const archivosCliente = [
    'src/components/diagnostico/FormularioDiagnostico.tsx',
    'src/components/auth/VistaProtegida.tsx',
    'src/components/auth/FormularioLogin.tsx',
    'src/components/auth/FormularioRegistro.tsx',
    'src/app/diagnostico/page.tsx',
    'src/lib/diagnostico/contrato.ts',
    'src/lib/diagnostico/preguntas.ts',
  ];
  for (const relativo of archivosCliente) {
    const contenido = readFileSync(path.join(RAIZ, relativo), 'utf8');
    assert.ok(!contenido.includes('GEMINI_API_KEY'), `${relativo} no debe mencionar la clave`);
    assert.ok(!contenido.includes('@/lib/gemini/cliente'), `${relativo} no debe importar el cliente de Gemini`);
  }
});

test('no existe ninguna variable NEXT_PUBLIC_GEMINI_* en el codigo', () => {
  const archivos = [
    'src/lib/gemini/cliente.ts',
    'src/lib/gemini/perfil.ts',
    'src/app/api/perfil/route.ts',
    'src/lib/supabase/servidor.ts',
    'src/components/diagnostico/FormularioDiagnostico.tsx',
  ];
  for (const relativo of archivos) {
    const contenido = readFileSync(path.join(RAIZ, relativo), 'utf8');
    assert.ok(!/NEXT_PUBLIC_GEMINI/.test(contenido), `${relativo} no debe declarar NEXT_PUBLIC_GEMINI_*`);
  }
});

test('la ruta de API no registra en consola la clave, el prompt ni la respuesta cruda del proveedor', () => {
  for (const relativo of ['src/app/api/perfil/route.ts', 'src/lib/gemini/cliente.ts', 'src/lib/gemini/perfil.ts']) {
    const contenido = readFileSync(path.join(RAIZ, relativo), 'utf8');
    assert.ok(!/console\.(log|error|warn|info|debug)/.test(contenido), `${relativo} no debe usar console.*`);
  }
});

test('el mensaje de error mostrado al usuario es fijo y no revela nada del proveedor', () => {
  assert.ok(MENSAJE_ERROR_PERFIL.length > 0);
  for (const termino of ['gemini', 'google', 'supabase', 'postgres', 'api', 'token', '500', '502']) {
    assert.ok(
      !MENSAJE_ERROR_PERFIL.toLowerCase().includes(termino),
      `el mensaje no debe mencionar "${termino}"`
    );
  }
});

// ============================================================
// F1-A1R -- Paridad de la barrera clinica entre TypeScript y SQL,
// y cierre de permisos de la RPC.
//
// Motivo del endurecimiento: la RPC guardar_diagnostico_con_perfil()
// esta expuesta a "authenticated", de modo que un usuario autenticado
// puede invocarla DIRECTAMENTE (por ejemplo desde la consola del
// navegador) sin pasar nunca por /api/perfil. Si la unica barrera
// clinica viviera en TypeScript, saltarsela seria trivial.
// ============================================================

// --- Conductuales (1-4): validacion real de TypeScript ---

test('F1-A1R: cada raiz clinica prohibida es rechazada por la validacion (conductual)', () => {
  for (const raiz of RAICES_CLINICAS_PROHIBIDAS) {
    const explicacion = `Aprendes con ejemplos y ${raiz} aparece en el texto.`;
    const resultado = validarPerfilDetectado({ ...PERFIL_VALIDO, explicacion });
    assert.equal(resultado.valido, false, `la raiz "${raiz}" debe rechazarse`);
    assert.equal(resultado.motivo, 'vocabulario_prohibido');
  }
});

test('F1-A1R: las variantes en mayusculas son rechazadas (conductual)', () => {
  for (const raiz of RAICES_CLINICAS_PROHIBIDAS) {
    const explicacion = `Nota: ${raiz.toUpperCase()} aparece aqui.`;
    const resultado = validarPerfilDetectado({ ...PERFIL_VALIDO, explicacion });
    assert.equal(resultado.valido, false, `"${raiz.toUpperCase()}" debe rechazarse`);
    assert.equal(resultado.motivo, 'vocabulario_prohibido');
  }
});

test('F1-A1R: las variantes con tildes y diacriticos son rechazadas (conductual)', () => {
  const conTildes = [
    'Presenta un déficit de atención evidente.',
    'Se recomienda evaluación psicológica.',
    'Podría tratarse de un síndrome específico.',
    'Sugiere una posible patología del aprendizaje.',
    'Conviene consultar a un psiquiatra.',
    'Muestra un retraso frente a su grupo.',
    'Se observa una condición clínica.',
  ];
  for (const explicacion of conTildes) {
    const resultado = validarPerfilDetectado({ ...PERFIL_VALIDO, explicacion });
    assert.equal(resultado.valido, false, `"${explicacion}" debe rechazarse`);
    assert.equal(resultado.motivo, 'vocabulario_prohibido');
  }
});

test('F1-A1R: contieneVocabularioProhibido devuelve la raiz concreta detectada (conductual)', () => {
  assert.equal(contieneVocabularioProhibido('Recomiendo evaluación psicológica.'), 'psicolog');
  assert.equal(contieneVocabularioProhibido('Tiene rasgos de Asperger.'), 'asperger');
  assert.equal(contieneVocabularioProhibido('Aprendes mejor con esquemas visuales.'), null);
});

test('F1-A1R: una explicacion educativa legitima sigue aceptandose (conductual)', () => {
  const legitimas = [
    'Aprendes mejor con imágenes y esquemas. Empieza por ejercicios de nivel medio.',
    'Te ayuda escuchar las explicaciones en voz alta; practica con audios cortos.',
    'Escribir resúmenes te funciona muy bien. Empieza por textos de dificultad media.',
    'Aprendes haciendo: prueba con ejercicios prácticos y sube poco a poco.',
  ];
  for (const explicacion of legitimas) {
    const resultado = validarPerfilDetectado({ ...PERFIL_VALIDO, explicacion });
    assert.equal(resultado.valido, true, `"${explicacion}" debe aceptarse`);
  }
});

// --- Estaticas (5-12): inspeccion del SQL de 0004 ---
//
// NOTA DE HONESTIDAD: las pruebas siguientes LEEN EL TEXTO de la
// migracion. Verifican arquitectura SQL que TODAVIA NO SE HA EJECUTADO
// contra PostgreSQL, y por tanto NO demuestran el comportamiento real de
// la RPC ni de los permisos: eso solo puede comprobarse tras aplicar
// 0004, y corresponde a la compuerta F1-A2. Su valor es impedir que
// estas restricciones se pierdan en una edicion posterior del archivo.

const RUTA_0004 = 'supabase/migrations/0004_dia3_guardar_perfil_detectado.sql';

function sqlDe0004() {
  return readFileSync(path.join(RAIZ, RUTA_0004), 'utf8');
}

// Solo lineas ejecutables: descarta los comentarios, para no confundir
// una mencion explicativa ("no se introduce service_role") con una
// sentencia real.
function sqlEjecutableDe0004() {
  return sqlDe0004()
    .split('\n')
    .filter((linea) => !linea.trim().startsWith('--'))
    .join('\n');
}

test('F1-A1R [ESTATICA]: 0004 declara en SQL las mismas raices clinicas que TypeScript (paridad)', () => {
  const sql = sqlEjecutableDe0004();
  for (const raiz of RAICES_CLINICAS_PROHIBIDAS) {
    assert.ok(sql.includes(`'${raiz}'`), `la raiz "${raiz}" debe estar tambien en ${RUTA_0004}`);
  }
});

test('F1-A1R2 [ESTATICA]: 0004 canoniza con normalize(NFD) y restringe a a-z0-9, sin extensiones', () => {
  const sql = sqlEjecutableDe0004();
  assert.ok(/normalize\(v_explicacion, NFD\)/.test(sql), 'debe descomponer la explicacion con normalize(..., NFD)');
  assert.ok(/normalize\(v_raiz, NFD\)/.test(sql), 'debe descomponer tambien cada raiz con normalize(..., NFD)');
  assert.ok(sql.includes('lower('), 'debe pasar a minusculas');
  const canonizaciones = sql.match(/regexp_replace\(lower\(normalize\([^)]+, NFD\)\), '\[\^a-z0-9\]', '', 'g'\)/g) ?? [];
  assert.equal(canonizaciones.length, 2, 'debe canonizarse la explicacion y cada raiz con la misma expresion');
  assert.ok(!/translate\(/i.test(sql), 'ya no debe usarse translate(): no cubre texto descompuesto');
  assert.ok(!/create extension/i.test(sql), 'no debe crear ninguna extension');
  assert.ok(!/unaccent/i.test(sql), 'no debe depender de unaccent');
  assert.ok(sql.includes('foreach v_raiz in array v_raices_prohibidas'), 'debe recorrer las raices');
});

test('F1-A1R2 [ESTATICA]: en 0004 la comparacion ocurre DESPUES de canonizar ambos lados', () => {
  const sql = sqlEjecutableDe0004();
  const asignacionCanonica = sql.indexOf('v_normalizada := regexp_replace(');
  const bucle = sql.indexOf('foreach v_raiz in array v_raices_prohibidas');
  const comparacion = sql.indexOf('in v_normalizada');
  assert.ok(asignacionCanonica > -1 && bucle > -1 && comparacion > -1);
  assert.ok(asignacionCanonica < bucle, 'la explicacion se canoniza antes de recorrer las raices');
  assert.ok(bucle < comparacion, 'la comparacion ocurre dentro del bucle, ya canonizada');
  // La raiz nunca se compara en crudo contra el texto canonico.
  assert.ok(
    !/position\(\s*v_raiz\s+in/.test(sql),
    'la raiz debe canonizarse antes de position(), nunca usarse tal cual'
  );
});

test('F1-A1R [ESTATICA]: la RPC revoca la ejecucion de PUBLIC con su firma exacta', () => {
  const sql = sqlEjecutableDe0004();
  assert.ok(
    /revoke all on function public\.guardar_diagnostico_con_perfil \(jsonb, jsonb\) from public;/i.test(sql),
    'debe existir un REVOKE explicito de PUBLIC'
  );
});

test('F1-A1R [ESTATICA]: la RPC revoca la ejecucion de anon con su firma exacta', () => {
  const sql = sqlEjecutableDe0004();
  assert.ok(
    /revoke all on function public\.guardar_diagnostico_con_perfil \(jsonb, jsonb\) from anon;/i.test(sql),
    'debe existir un REVOKE explicito de anon'
  );
});

test('F1-A1R [ESTATICA]: solo authenticated recibe EXECUTE sobre la RPC', () => {
  const sql = sqlEjecutableDe0004();
  const concesiones = sql.match(/grant execute on function public\.guardar_diagnostico_con_perfil[^;]*;/gi) ?? [];
  assert.equal(concesiones.length, 1, 'debe haber exactamente una concesion de EXECUTE');
  assert.ok(/to authenticated;/i.test(concesiones[0]), 'la unica concesion debe ser a authenticated');
  for (const rol of ['anon', 'public', 'postgres', 'service_role']) {
    assert.ok(!new RegExp(`to ${rol}\\s*;`, 'i').test(concesiones[0]), `no debe concederse a ${rol}`);
  }
});

test('F1-A1R [ESTATICA]: la funcion de validacion no queda ejecutable por ningun rol de la API', () => {
  const sql = sqlEjecutableDe0004();
  for (const rol of ['public', 'anon', 'authenticated']) {
    assert.ok(
      new RegExp(`revoke all on function public\\.es_perfil_detectado_valido \\(jsonb\\) from ${rol};`, 'i').test(sql),
      `debe revocarse la ejecucion de ${rol}`
    );
  }
  assert.ok(
    !/grant execute on function public\.es_perfil_detectado_valido/i.test(sql),
    'no debe concederse EXECUTE sobre la funcion de validacion'
  );
});

test('F1-A1R [ESTATICA]: la RPC no acepta ningun identificador de usuario del cliente', () => {
  const sql = sqlEjecutableDe0004();
  const inicio = sql.indexOf('create or replace function public.guardar_diagnostico_con_perfil');
  assert.ok(inicio > -1, 'debe existir la definicion de la RPC');
  const firma = sql.slice(inicio, sql.indexOf('returns table', inicio));
  assert.ok(firma.includes('p_respuestas jsonb'), 'debe recibir las respuestas');
  assert.ok(firma.includes('p_perfil jsonb'), 'debe recibir el perfil');
  assert.ok(!/usuario_id/i.test(firma), 'no debe existir ningun parametro de usuario');
});

test('F1-A1R [ESTATICA]: la identidad procede de auth.uid() y el search_path sigue endurecido', () => {
  const sql = sqlEjecutableDe0004();
  assert.ok(sql.includes('v_usuario_id uuid := auth.uid();'), 'el propietario debe salir de auth.uid()');
  assert.ok(sql.includes('if v_usuario_id is null then'), 'debe rechazarse la ausencia de sesion');
  const endurecidas = sql.match(/set search_path = pg_catalog/g) ?? [];
  assert.equal(endurecidas.length, 2, 'ambas funciones deben fijar search_path = pg_catalog');
  assert.ok(sql.includes('security definer'), 'la RPC debe ser SECURITY DEFINER');
});

test('F1-A1R [ESTATICA]: la validacion del perfil ocurre ANTES del INSERT', () => {
  const sql = sqlEjecutableDe0004();
  const validacionPerfil = sql.indexOf('if not public.es_perfil_detectado_valido(p_perfil)');
  const validacionRespuestas = sql.indexOf('if not public.es_respuestas_diagnostico_valido(p_respuestas)');
  const duplicado = sql.indexOf('El usuario ya tiene un diagnostico registrado');
  const insercion = sql.indexOf('insert into public.diagnosticos');
  assert.ok(validacionRespuestas > -1 && validacionPerfil > -1 && insercion > -1 && duplicado > -1);
  assert.ok(validacionRespuestas < insercion, 'las respuestas se validan antes del INSERT');
  assert.ok(validacionPerfil < insercion, 'el perfil se valida antes del INSERT');
  assert.ok(duplicado < insercion, 'el duplicado se detecta antes del INSERT');
});

test('F1-A1R [ESTATICA]: 0004 no introduce service_role ni permisos administrativos', () => {
  const sql = sqlEjecutableDe0004();
  assert.ok(!/service_role/i.test(sql), 'ninguna sentencia debe mencionar service_role');
  assert.ok(!/grant\s+all/i.test(sql), 'no debe concederse ALL a ningun rol');
  assert.ok(!/bypassrls|superuser/i.test(sql));
  assert.ok(!/grant\s+update[^;]*diagnosticos/i.test(sql), 'no debe concederse UPDATE sobre diagnosticos');
  assert.ok(!/grant[^;]*perfil_detectado/i.test(sql), 'no debe concederse acceso directo a perfil_detectado');
});

// ============================================================
// F1-A1R2 -- Normalizacion canonica: formas Unicode descompuestas y
// separadores evasivos.
//
// Defecto que motiva este bloque: "diagnóstico clínico" se
// ve identico a "diagnóstico clínico" pero es otra secuencia de
// caracteres. Una comparacion que solo sustituya vocales acentuadas
// precompuestas no lo detecta. Como "authenticated" puede invocar la RPC
// directamente, ese hueco era un atajo real alrededor de la barrera.
// ============================================================

// --- Conductuales ---

test('F1-A1R2: canonizarParaComparar produce la forma canonica esperada (conductual)', () => {
  assert.equal(canonizarParaComparar('diagnóstico clínico'), 'diagnosticoclinico');
  assert.equal(canonizarParaComparar('diagnóstico clínico'), 'diagnosticoclinico');
  assert.equal(canonizarParaComparar('DIAGNÓSTICO CLÍNICO'), 'diagnosticoclinico');
  assert.equal(canonizarParaComparar('diag-nóstico clínico'), 'diagnosticoclinico');
  assert.equal(canonizarParaComparar('T.D.A.H.'), 'tdah');
  assert.equal(canonizarParaComparar('déficit  de atención'), 'deficitdeatencion');
});

test('F1-A1R2: la forma precompuesta y la descompuesta canonizan igual (conductual)', () => {
  const precompuesta = 'diagnóstico clínico';
  const descompuesta = 'diagnóstico clínico';
  assert.notEqual(precompuesta, descompuesta, 'deben ser cadenas distintas, no la misma');
  assert.equal(canonizarParaComparar(precompuesta), canonizarParaComparar(descompuesta));
});

test('F1-A1R2: cada raiz en forma NFD descompuesta es rechazada (conductual)', () => {
  for (const raiz of RAICES_CLINICAS_PROHIBIDAS) {
    // Se reintroducen tildes descompuestas sobre cada vocal de la raiz.
    const enNfd = raiz.replace(/[aeiou]/g, (vocal) => `${vocal}́`);
    const resultado = validarPerfilDetectado({ ...PERFIL_VALIDO, explicacion: `Nota: ${enNfd} aqui.` });
    assert.equal(resultado.valido, false, `la raiz "${raiz}" en NFD debe rechazarse`);
    assert.equal(resultado.motivo, 'vocabulario_prohibido');
  }
});

test('F1-A1R2: "diagno\\u0301stico cli\\u0301nico" es rechazado (conductual)', () => {
  const resultado = validarPerfilDetectado({
    ...PERFIL_VALIDO,
    explicacion: 'El resultado es un diagnóstico clínico del estudiante.',
  });
  assert.equal(resultado.valido, false);
  assert.equal(resultado.motivo, 'vocabulario_prohibido');
});

test('F1-A1R2: una marca combinante dentro de una raiz no permite eludirla (conductual)', () => {
  for (const explicacion of ['Presenta aut́ismo leve.', 'Hay un trástorno visible.', 'Se observa disléxia.']) {
    const resultado = validarPerfilDetectado({ ...PERFIL_VALIDO, explicacion });
    assert.equal(resultado.valido, false, `"${explicacion}" debe rechazarse`);
    assert.equal(resultado.motivo, 'vocabulario_prohibido');
  }
});

test('F1-A1R2: los separadores evasivos no permiten eludir el filtro (conductual)', () => {
  const evasivas = [
    'Podría ser T.D.A.H. en su caso.',
    'Se trata de un diag-nóstico clí-nico.',
    'Presenta a s p e r g e r según la prueba.',
    'Hay un tras_torno de fondo.',
    'Indica dis/capacidad de aprendizaje.',
  ];
  for (const explicacion of evasivas) {
    const resultado = validarPerfilDetectado({ ...PERFIL_VALIDO, explicacion });
    assert.equal(resultado.valido, false, `"${explicacion}" debe rechazarse`);
    assert.equal(resultado.motivo, 'vocabulario_prohibido');
  }
});

test('F1-A1R2: espacios repetidos o irregulares no permiten eludir el filtro (conductual)', () => {
  for (const explicacion of ['Hay un déficit  de atención.', 'Se ve un   diagnóstico   clínico.']) {
    const resultado = validarPerfilDetectado({ ...PERFIL_VALIDO, explicacion });
    assert.equal(resultado.valido, false, `"${explicacion}" debe rechazarse`);
    assert.equal(resultado.motivo, 'vocabulario_prohibido');
  }
});

test('F1-A1R2: explicaciones educativas legitimas siguen aceptandose pese al filtro mas estricto (conductual)', () => {
  const legitimas = [
    'Aprendes mejor con imágenes y esquemas. Empieza por ejercicios de nivel medio.',
    'Te ayuda escuchar las explicaciones en voz alta; practica con audios cortos.',
    'Escribir resúmenes te funciona muy bien. Empieza por textos de dificultad media.',
    'Aprendes haciendo: prueba con ejercicios prácticos y sube poco a poco.',
    'Te apoyas mucho en la lectura; usa resúmenes y listas para avanzar con seguridad.',
    'Recuerdas mejor lo que escuchas. Repite en voz alta y comenta lo aprendido.',
  ];
  for (const explicacion of legitimas) {
    const resultado = validarPerfilDetectado({ ...PERFIL_VALIDO, explicacion });
    assert.equal(resultado.valido, true, `"${explicacion}" no debe activar el filtro`);
  }
});

test('F1-A1R2: la validacion NO modifica la explicacion que se persiste (conductual)', () => {
  const original = 'Aprendes mejor con imágenes, esquemas y práctica: ¡sigue así!';
  const resultado = validarPerfilDetectado({ ...PERFIL_VALIDO, explicacion: original });
  assert.equal(resultado.valido, true);
  // Se conserva tal cual (con acentos, signos y mayusculas). La forma
  // canonica solo existe dentro de la comparacion.
  assert.equal(resultado.perfil.explicacion, original);
  assert.notEqual(resultado.perfil.explicacion, canonizarParaComparar(original));
});

test('F1-A1R2: se conservan exactamente las 19 raices canonicas, sin ampliar el contrato', () => {
  assert.equal(RAICES_CLINICAS_PROHIBIDAS.length, 19);
  assert.deepEqual([...ESTILOS_APRENDIZAJE], ['visual', 'auditivo', 'lectoescritor', 'kinestesico']);
  assert.equal(LONGITUD_MAXIMA_EXPLICACION, 400);
});

test('F1-A1R [ESTATICA]: 0004 no modifica objetos creados en 0001, 0002 ni 0003', () => {
  const sql = sqlEjecutableDe0004();
  assert.ok(!/alter table/i.test(sql), 'no debe alterar ninguna tabla');
  assert.ok(!/drop\s+(table|function|policy|trigger)/i.test(sql), 'no debe eliminar objetos existentes');
  assert.ok(!/create policy|alter policy/i.test(sql), 'no debe crear ni alterar policies');
  assert.ok(
    !/create or replace function public\.(es_respuestas_diagnostico_valido|registrar_intento|handle_new_user)/i.test(sql),
    'no debe redefinir funciones de migraciones anteriores'
  );
});
