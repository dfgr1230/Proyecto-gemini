#!/usr/bin/env node
// Utilidad temporal del Checkpoint 4 (Fase 2 - Dia 2).
// Verifica, contra el proyecto real de Supabase y usando EXCLUSIVAMENTE
// el cliente publico autenticado (nunca service_role), que public.diagnosticos
// esta correctamente protegida:
//   - el CHECK es_respuestas_diagnostico_valido() rechaza estructuras invalidas;
//   - la politica RLS diagnosticos_insert_propio (WITH CHECK auth.uid() =
//     usuario_id) impide que un usuario inserte un diagnostico a nombre
//     de otro;
//   - un diagnostico valido se acepta;
//   - la restriccion UNIQUE sobre usuario_id bloquea un segundo diagnostico.
//
// No contiene correos, contrasenas, tokens ni UUID: todo se solicita en
// tiempo de ejecucion y vive solo en memoria mientras el proceso corre.
//
// Requiere NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
// ya definidas en el entorno (ver .env.local). Ejecutar con:
//   node --env-file=.env.local scripts/checkpoint4-diagnosticos.mjs
//
// Es un script HERMANO de scripts/checkpoint2-auth-trigger.mjs y
// scripts/checkpoint3-rls-aislamiento.mjs, no una ampliacion de ninguno
// de los dos -- ninguno de esos dos archivos fue modificado para crear
// este (salvo, en checkpoint3, una correccion textual de un comentario,
// autorizada y documentada aparte, sin tocar su logica).
//
// ORDEN DE LAS PRUEBAS (importante, deliberado): el intento de
// suplantacion (Usuario B insertando con el usuario_id de Usuario A) se
// ejecuta ANTES de que Usuario A tenga un diagnostico valido. Si se
// ejecutara despues, un eventual acierto de la restriccion UNIQUE
// (usuario_id ya usado) podria enmascarar si el verdadero motivo del
// rechazo fue RLS o la unicidad -- dos restricciones distintas que
// nunca deben confundirse entre si. Ejecutando la suplantacion primero,
// cuando Usuario A todavia tiene 0 diagnosticos, el UNIQUE no puede
// intervenir en absoluto: solo la politica RLS puede rechazar ese
// INSERT, aislando la senal sin ambiguedad.

import { createClient } from '@supabase/supabase-js';
import readline from 'node:readline/promises';
import { clearLine, cursorTo } from 'node:readline';
import { stdin, stdout } from 'node:process';
import https from 'node:https';
import { URL as NodeURL } from 'node:url';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    '[ERROR] Faltan NEXT_PUBLIC_SUPABASE_URL y/o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY en el entorno.\n' +
      'Completa .env.local y ejecuta con: node --env-file=.env.local scripts/checkpoint4-diagnosticos.mjs'
  );
  process.exit(1);
}

// ============================================================
// Copia literal (sin cambios) de scripts/checkpoint3-rls-aislamiento.mjs:
// SimpleHeaders, SimpleResponse, nodeHttpsFetch, askHidden(), maskEmail(),
// shortId(), categorizarCodigo(), reportError(). Ver ese archivo (o
// checkpoint2-auth-trigger.mjs, donde se corrigieron originalmente) para
// el detalle de por que existen.
// ============================================================
class SimpleHeaders {
  constructor(init) {
    this._map = new Map();
    if (init) this.mergeFrom(init);
  }
  mergeFrom(init) {
    if (!init) return;
    if (init instanceof SimpleHeaders) {
      for (const [k, v] of init._map.entries()) this.set(k, v);
    } else if (typeof init[Symbol.iterator] === 'function') {
      for (const pair of init) this.set(pair[0], pair[1]);
    } else if (typeof init === 'object') {
      for (const k of Object.keys(init)) this.set(k, init[k]);
    }
  }
  set(name, value) {
    this._map.set(String(name).toLowerCase(), String(Array.isArray(value) ? value.join(', ') : value));
  }
  get(name) {
    const key = String(name).toLowerCase();
    return this._map.has(key) ? this._map.get(key) : null;
  }
  has(name) {
    return this._map.has(String(name).toLowerCase());
  }
  forEach(cb) {
    this._map.forEach((v, k) => cb(v, k, this));
  }
}

class SimpleResponse {
  constructor(bodyText, { status, statusText, headers }) {
    this.status = status;
    this.statusText = statusText ?? '';
    this.ok = status >= 200 && status < 300;
    this.headers = headers instanceof SimpleHeaders ? headers : new SimpleHeaders(headers);
    this._bodyText = bodyText ?? '';
  }
  async json() {
    return JSON.parse(this._bodyText);
  }
  async text() {
    return this._bodyText;
  }
}

function nodeHttpsFetch(input, init = {}) {
  return new Promise((resolve, reject) => {
    let urlObj;
    let method = init.method;
    let bodyInput = init.body;
    let signal = init.signal;

    const headers = new SimpleHeaders();

    if (input && typeof input === 'object' && typeof input.url === 'string') {
      urlObj = new NodeURL(input.url);
      method = method || input.method;
      signal = signal || input.signal;
      if (input.headers) headers.mergeFrom(input.headers);
    } else {
      urlObj = new NodeURL(String(input));
    }
    method = method || 'GET';

    if (init.headers) headers.mergeFrom(init.headers);

    let bodyBuffer;
    if (bodyInput !== undefined && bodyInput !== null) {
      bodyBuffer = Buffer.isBuffer(bodyInput) ? bodyInput : Buffer.from(String(bodyInput), 'utf8');
      if (!headers.get('content-length')) headers.set('content-length', String(bodyBuffer.length));
    }

    const plainHeaders = {};
    headers.forEach((v, k) => {
      plainHeaders[k] = v;
    });

    const req = https.request(
      {
        protocol: urlObj.protocol,
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method,
        headers: plainHeaders,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const bodyText = Buffer.concat(chunks).toString('utf8');
          const responseHeaders = new SimpleHeaders();
          for (const [key, value] of Object.entries(res.headers)) {
            if (value !== undefined) {
              responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
            }
          }
          resolve(
            new SimpleResponse(bodyText, {
              status: res.statusCode,
              statusText: res.statusMessage,
              headers: responseHeaders,
            })
          );
        });
      }
    );

    req.on('error', (err) => {
      reject(err);
    });

    if (signal) {
      if (signal.aborted) {
        req.destroy();
        const abortError = new Error('Aborted');
        abortError.name = 'AbortError';
        reject(abortError);
        return;
      }
      signal.addEventListener(
        'abort',
        () => {
          req.destroy();
          const abortError = new Error('Aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        },
        { once: true }
      );
    }

    if (bodyBuffer) req.write(bodyBuffer);
    req.end();
  });
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: nodeHttpsFetch },
});

const rl = readline.createInterface({ input: stdin, output: stdout });

async function ask(promptText) {
  return (await rl.question(promptText)).trim();
}

const CODE_CTRL_C = 3;
const CODE_CTRL_D = 4;
const CODE_BACKSPACE = 8;
const CODE_DEL = 127;

async function askHidden(promptText) {
  stdout.write(promptText);

  const savedKeypressListeners = stdin.listeners('keypress');
  stdin.removeAllListeners('keypress');

  const wasRaw = stdin.isRaw;
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  const restoreTerminal = () => {
    if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
    for (const fn of savedKeypressListeners) stdin.on('keypress', fn);
    stdin.resume();
  };

  const redrawFinal = (marker) => {
    if (stdout.isTTY) {
      cursorTo(stdout, 0);
      clearLine(stdout, 0);
    }
    stdout.write(promptText + marker + '\n');
  };

  let value = '';
  try {
    return await new Promise((resolve) => {
      const onData = (chunk) => {
        for (const char of chunk.toString()) {
          if (char === '\n' || char === '\r') {
            stdin.removeListener('data', onData);
            redrawFinal('[recibida]');
            resolve(value);
            return;
          }
          const code = char.charCodeAt(0);
          if (code === CODE_CTRL_C || code === CODE_CTRL_D) {
            stdin.removeListener('data', onData);
            restoreTerminal();
            redrawFinal('[cancelada]');
            process.exit(130);
            return;
          }
          if (code === CODE_BACKSPACE || code === CODE_DEL) {
            if (value.length > 0) {
              value = value.slice(0, -1);
              if (stdout.isTTY) stdout.write('\b \b');
            }
            continue;
          }
          value += char;
          stdout.write('*');
        }
      };
      stdin.on('data', onData);
    });
  } finally {
    restoreTerminal();
  }
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return '(no disponible)';
  const [local, domain] = email.split('@');
  const visible = local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(local.length - visible.length, 3))}@${domain}`;
}

function shortId(id) {
  if (!id) return '(no disponible)';
  return `${id.slice(0, 8)}...`;
}

function categorizarCodigo(code) {
  const DNS = ['ENOTFOUND', 'EAI_AGAIN'];
  const RECHAZADA = ['ECONNREFUSED', 'ECONNRESET'];
  const TIMEOUT = ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'];
  const TLS = [
    'CERT_HAS_EXPIRED',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'ERR_TLS_CERT_ALTNAME_INVALID',
  ];
  if (DNS.includes(code)) return 'DNS (no se pudo resolver el hostname)';
  if (RECHAZADA.includes(code)) return 'conexion rechazada/reiniciada (posible firewall o VPN)';
  if (TIMEOUT.includes(code)) return 'timeout de conexion';
  if (TLS.includes(code)) return 'TLS/certificado (posible interceptacion de antivirus o proxy corporativo)';
  return code ? 'otra (ver codigo tecnico)' : 'desconocida (sin codigo tecnico disponible)';
}

// IMPORTANTE (sanitizacion): PostgrestError trae ademas los campos
// "details" y "hint", que aqui se leen DELIBERADAMENTE NUNCA -- el
// campo DETAIL de Postgres para una violacion de UNIQUE incluye el
// valor real de la columna en conflicto (aqui seria el UUID de
// usuario_id), y por eso jamas se imprime. Solo se muestran
// "message"/"status"/"code" (y la cadena de "cause" para errores de
// transporte), que para las restricciones de este checkpoint (23514,
// 23505, 42501) son mensajes genericos de Postgres sin valores
// incrustados -- se verifico leyendo el comportamiento estandar de
// Postgres para estos codigos antes de asumirlo.
function reportError(label, error) {
  if (!error) {
    console.log(`[${label}] Sin error.`);
    return;
  }
  console.log(`[${label}] Error controlado -> status: ${error.status ?? 'n/d'}, code: ${error.code ?? 'n/d'}, mensaje: ${error.message}`);

  let cause = error.cause;
  let nivel = 1;
  while (cause && nivel <= 3) {
    console.log(
      `  causa nivel ${nivel} -> name: ${cause.name ?? 'n/d'}, code: ${cause.code ?? 'n/d'}, ` +
        `errno: ${cause.errno ?? 'n/d'}, mensaje: ${cause.message ?? 'n/d'}, ` +
        `categoria: ${categorizarCodigo(cause.code)}`
    );
    cause = cause.cause;
    nivel += 1;
  }
}

// ============================================================
// Logica especifica de Checkpoint 4.
// ============================================================

async function pedirCredenciales(etiqueta) {
  const email = await ask(`Correo de ${etiqueta}: `);
  const password = await askHidden(`Contrasena de ${etiqueta} (oculta): `);
  return { email, password };
}

async function iniciarSesion(etiqueta, credenciales) {
  const { data, error } = await supabase.auth.signInWithPassword(credenciales);
  if (error) {
    reportError(`login-${etiqueta}`, error);
    return null;
  }
  console.log(`[login-${etiqueta}] Sesion iniciada.`);
  console.log(`  id: ${shortId(data.user?.id)}`);
  console.log(`  correo: ${maskEmail(data.user?.email)}`);
  return data.user?.id ?? null;
}

// Devuelve boolean: true si el cierre fue correcto, false si hubo error
// (esto alimenta la comprobacion "Sesiones cerradas" del resumen final).
async function cerrarSesion(etiqueta) {
  const { error } = await supabase.auth.signOut();
  if (error) {
    reportError(`signOut-${etiqueta}`, error);
    return false;
  }
  console.log(`[signOut-${etiqueta}] Sesion cerrada.`);
  return true;
}

// ----------------------------------------------------------------
// Contrato real de public.es_respuestas_diagnostico_valido() (leido
// directamente del SQL, no asumido): objeto JSON con ENTRE 10 Y 15
// claves; cada clave no vacia tras trim(); cada valor debe ser string,
// number o boolean (nunca null, objeto ni arreglo); si el valor es
// string, no puede quedar vacio tras trim(). No exige ningun patron de
// nombre de clave (el prefijo "p1".."p15" es solo convencion, no
// impuesta por la funcion).
// ----------------------------------------------------------------

// Carga VALIDA: exactamente 10 claves (el minimo permitido), todas con
// valores string no vacios. Datos sinteticos, deterministas, sin
// relacion con personas reales.
const CARGA_RESPUESTAS_VALIDA = Object.freeze({
  p1: 'A',
  p2: 'B',
  p3: 'C',
  p4: 'A',
  p5: 'B',
  p6: 'C',
  p7: 'A',
  p8: 'B',
  p9: 'C',
  p10: 'A',
});

// Carga INVALIDA: identica a la valida pero con SOLO 9 claves -- viola
// unicamente la condicion "entre 10 y 15 claves" del CHECK (v_count < 10
// en es_respuestas_diagnostico_valido). Deliberadamente NO se usa un
// valor null/objeto/arreglo ni una clave vacia para esta carga, para que
// la unica condicion incumplida sea la cantidad de claves -- evita
// cualquier ambiguedad sobre cual regla disparo el rechazo, y evita per
// completo tocar NOT NULL, tipos de columna, usuario_id o permisos.
const CARGA_RESPUESTAS_INVALIDA = Object.freeze({
  p1: 'A',
  p2: 'B',
  p3: 'C',
  p4: 'A',
  p5: 'B',
  p6: 'C',
  p7: 'A',
  p8: 'B',
  p9: 'C',
});

// SQLSTATE de Postgres: 5 caracteres alfanumericos en mayuscula. Se usa
// para distinguir "la base de datos rechazo la operacion por una razon
// de negocio" (codigo con esta forma) de "fallo de red/autenticacion/
// transporte" (sin codigo reconocible, p.ej. AuthRetryableFetchError).
function pareceCodigoPostgres(code) {
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code);
}

// Un 42501 por si solo NO basta: insufficient_privilege puede tener
// otras causas. Solo se acepta como bloqueo de RLS si el mensaje
// tambien menciona explicitamente la politica de seguridad a nivel de
// fila -- el texto exacto que Postgres emite para este caso.
function esBloqueoDeRLS(error) {
  if (!error || error.code !== '42501') return false;
  const mensaje = (error.message || '').toLowerCase();
  return mensaje.includes('row-level security') || mensaje.includes('row level security') || mensaje.includes('policy');
}

async function contarDiagnosticosPropios(etiqueta) {
  const { data, error } = await supabase.from('diagnosticos').select('id, usuario_id');
  if (error) {
    reportError(etiqueta, error);
    return { error: true };
  }
  return { error: false, filas: data ?? [] };
}

// CASO 0: precondicion. Usuario A debe ver exactamente 0 diagnosticos
// propios antes de empezar. Si ve 1 o mas, la prueba no debe continuar
// (no se borra ni modifica nada): se clasifica como precondicion
// incumplida (INCONCLUSO) y se requiere una cuenta limpia.
async function verificarPrecondicionLimpia() {
  const r = await contarDiagnosticosPropios('precondicion-usuarioA');
  if (r.error) return 'error_tecnico';
  if (r.filas.length === 0) {
    console.log('[precondicion-usuarioA] Cuenta limpia: 0 diagnosticos previos.');
    return 'exito';
  }
  console.log(
    `[precondicion-usuarioA] INCONCLUSO: se encontraron ${r.filas.length} diagnostico(s) previos. ` +
      'Se requiere una cuenta limpia para esta prueba; no se modifica ni se borra nada.'
  );
  return 'precondicion_incumplida';
}

// CASO 1: INSERT con respuestas invalidas (Usuario A). Exito = error
// 23514 en el INSERT, y una verificacion posterior confirma 0 filas.
async function probarInsertInvalidoConId(idA) {
  const { data, error } = await supabase
    .from('diagnosticos')
    .insert({ usuario_id: idA, respuestas: CARGA_RESPUESTAS_INVALIDA });
  void data;

  if (!error) {
    console.log('[caso1-invalido] FALLO: el INSERT con respuestas invalidas fue aceptado (no deberia haber ocurrido).');
    return 'fallo';
  }
  if (error.code !== '23514') {
    reportError('caso1-invalido', error);
    console.log(
      '[caso1-invalido] INCONCLUSO: hubo error pero con codigo distinto de 23514; ' +
        'no se puede atribuir con certeza a la restriccion CHECK sometida a prueba.'
    );
    return 'error_tecnico';
  }
  console.log('[caso1-invalido] Rechazo esperado: error 23514 (CHECK de respuestas) recibido.');

  const verificacion = await contarDiagnosticosPropios('caso1-verificacion');
  if (verificacion.error) return 'error_tecnico';
  if (verificacion.filas.length === 0) {
    console.log('[caso1-verificacion] Confirmado: Usuario A continua con 0 diagnosticos.');
    return 'rechazo_esperado';
  }
  console.log(`[caso1-verificacion] FALLO: se encontraron ${verificacion.filas.length} fila(s) pese al rechazo reportado.`);
  return 'fallo';
}

// CASO 2: Usuario B intenta insertar usando el usuario_id de Usuario A.
// Exito = rechazo atribuible inequivocamente a RLS. Si el INSERT es
// aceptado (se devuelve una fila), es una BRECHA CRITICA: no se
// imprime la fila ni el id, se marca fallo_critico, y el llamador debe
// detener cualquier INSERT adicional.
async function probarSuplantacion(idAjeno) {
  const { data, error } = await supabase
    .from('diagnosticos')
    .insert({ usuario_id: idAjeno, respuestas: CARGA_RESPUESTAS_VALIDA })
    .select();

  if (!error && data && data.length > 0) {
    console.log(
      '[caso2-suplantacion] FALLO CRITICO DE AISLAMIENTO: el INSERT con usuario_id ajeno fue aceptado. ' +
        'No se imprime la fila ni el identificador.'
    );
    return 'fallo_critico';
  }
  if (!error) {
    console.log(
      '[caso2-suplantacion] INCONCLUSO: la respuesta no incluyo error ni fila -- ' +
        'no permite confirmar un bloqueo de RLS.'
    );
    return 'error_tecnico';
  }
  if (esBloqueoDeRLS(error)) {
    console.log('[caso2-suplantacion] Bloqueo esperado: error atribuible inequivocamente a la politica RLS.');
    return 'rechazo_esperado';
  }
  reportError('caso2-suplantacion', error);
  console.log(
    '[caso2-suplantacion] INCONCLUSO: hubo error pero no es atribuible inequivocamente a RLS ' +
      '(23505 y 23514, en particular, NUNCA se aceptan como demostracion de bloqueo RLS).'
  );
  return 'error_tecnico';
}

// Verificacion POSTERIOR e independiente del intento de suplantacion,
// hecha desde la propia sesion de Usuario A -- la unica identidad que
// puede ver sus propias filas via RLS (Usuario B nunca podria confirmar
// esto por si mismo, por diseno). Se ejecuta ANTES de cualquier INSERT
// nuevo en esta segunda sesion de Usuario A. Exito = 0 filas. Si
// aparece 1 o mas, es una BRECHA CRITICA independiente de lo que haya
// reportado el INSERT de Usuario B (podria revelar, por ejemplo, que la
// respuesta inmediata del INSERT no reflejo el estado real).
async function verificarAusenciaDeSuplantacion() {
  const verificacion = await contarDiagnosticosPropios('post-suplantacion-usuarioA');
  if (verificacion.error) return 'error_tecnico';
  if (verificacion.filas.length === 0) {
    console.log('[post-suplantacion-usuarioA] Confirmado: Usuario A continua con 0 diagnosticos tras el intento de suplantacion.');
    return 'exito';
  }
  console.log(
    `[post-suplantacion-usuarioA] FALLO CRITICO DE AISLAMIENTO: se encontraron ${verificacion.filas.length} ` +
      'fila(s) tras el intento de suplantacion. No se imprime su contenido.'
  );
  return 'fallo_critico';
}

// Combina la evidencia del INSERT de Usuario B (rechazo inmediato,
// caso 2) con la verificacion posterior desde Usuario A, para la
// comprobacion compuesta "Intento ajeno no creo diagnostico para
// Usuario A". Deliberadamente distinta de la precondicion inicial
// (caso 0): son momentos y evidencias diferentes, y no deben combinarse
// entre si.
function combinarResultadoSuplantacion(resultadoInsertAjeno, resultadoVerificacionPosterior) {
  if (resultadoInsertAjeno === 'fallo_critico' || resultadoVerificacionPosterior === 'fallo_critico') {
    return 'fallo_critico';
  }
  if (resultadoInsertAjeno === 'rechazo_esperado' && resultadoVerificacionPosterior === 'exito') {
    return 'exito';
  }
  if (resultadoInsertAjeno === 'error_tecnico' || resultadoVerificacionPosterior === 'error_tecnico') {
    return 'error_tecnico';
  }
  return 'no_ejecutado';
}

// CASO 3: INSERT valido (Usuario A). Exito = sin error, y una
// verificacion posterior confirma exactamente 1 fila propia con el
// contenido esperado.
async function probarInsertValido(idA) {
  const { error: errorInsert } = await supabase
    .from('diagnosticos')
    .insert({ usuario_id: idA, respuestas: CARGA_RESPUESTAS_VALIDA })
    .select();

  if (errorInsert) {
    reportError('caso3-valido', errorInsert);
    if (pareceCodigoPostgres(errorInsert.code)) {
      console.log('[caso3-valido] FALLO: un INSERT valido para el propio usuario fue rechazado por una restriccion de base de datos.');
      return 'fallo';
    }
    console.log('[caso3-valido] INCONCLUSO: fallo de autenticacion, red o transporte.');
    return 'error_tecnico';
  }

  const verificacion = await contarDiagnosticosPropios('caso3-verificacion');
  if (verificacion.error) return 'error_tecnico';

  if (verificacion.filas.length !== 1) {
    console.log(`[caso3-verificacion] FALLO: se esperaba exactamente 1 fila, se encontraron ${verificacion.filas.length}.`);
    return 'fallo';
  }
  const fila = verificacion.filas[0];
  if (fila.usuario_id !== idA) {
    console.log('[caso3-verificacion] FALLO: la fila encontrada no pertenece a Usuario A.');
    return 'fallo';
  }
  console.log('[caso3-verificacion] Exito: exactamente 1 fila propia.');
  return 'exito';
}

// CASO 4: segundo INSERT valido (Usuario A). Exito = error 23505, y una
// verificacion final confirma que sigue existiendo exactamente 1 fila.
async function probarSegundoInsertConId(idA) {
  const { error } = await supabase
    .from('diagnosticos')
    .insert({ usuario_id: idA, respuestas: CARGA_RESPUESTAS_VALIDA });

  if (!error) {
    console.log('[caso4-duplicado] FALLO: el segundo INSERT valido fue aceptado (no deberia haber ocurrido).');
    return 'fallo';
  }
  if (error.code !== '23505') {
    reportError('caso4-duplicado', error);
    console.log(
      '[caso4-duplicado] INCONCLUSO: hubo error pero con codigo distinto de 23505; ' +
        'no se puede atribuir con certeza a la restriccion UNIQUE.'
    );
    return 'error_tecnico';
  }
  console.log('[caso4-duplicado] Rechazo esperado: error 23505 (UNIQUE de usuario_id) recibido.');
  return 'rechazo_esperado';
}

async function verificarIntegridadFinal(idA) {
  const verificacion = await contarDiagnosticosPropios('integridad-final');
  if (verificacion.error) return 'error_tecnico';
  if (verificacion.filas.length === 1 && verificacion.filas[0].usuario_id === idA) {
    console.log('[integridad-final] Confirmado: exactamente 1 fila propia, sin cambios indebidos.');
    return 'exito';
  }
  console.log(`[integridad-final] FALLO: se esperaba exactamente 1 fila propia; se encontraron ${verificacion.filas.length}.`);
  return 'fallo';
}

function marcaResultado(v) {
  if (v === 'exito' || v === 'rechazo_esperado') return '✅';
  if (v === 'fallo' || v === 'fallo_critico') return '❌';
  return '⚠️'; // error_tecnico, no_ejecutado, precondicion_incumplida
}

function calcularResultadoGlobal(resultados) {
  const valores = Object.values(resultados);
  const hayFallo = valores.some((v) => v === 'fallo' || v === 'fallo_critico');
  const hayInconcluso = valores.some(
    (v) => v === 'error_tecnico' || v === 'no_ejecutado' || v === 'precondicion_incumplida'
  );
  if (hayFallo) return 'NO APROBADO';
  if (hayInconcluso) return 'INCONCLUSO';
  return 'APROBADO';
}

function mostrarResumen(r) {
  console.log('\n=== RESUMEN CHECKPOINT 4 -- validacion y proteccion de diagnosticos ===');
  console.log(`Precondicion de Usuario A limpia: ${marcaResultado(r.precondicionLimpia)} (${r.precondicionLimpia})`);
  console.log(`Diagnostico invalido rechazado por CHECK: ${marcaResultado(r.invalidoRechazadoPorCheck)} (${r.invalidoRechazadoPorCheck})`);
  console.log(`Usuario B bloqueado al insertar para Usuario A: ${marcaResultado(r.usuarioBBloqueadoPorRLS)} (${r.usuarioBBloqueadoPorRLS})`);
  console.log(
    `Intento ajeno no creo diagnostico para Usuario A: ${marcaResultado(r.intentoAjenoNoCreoDiagnostico)} (${r.intentoAjenoNoCreoDiagnostico})`
  );
  console.log(`Diagnostico valido de Usuario A aceptado: ${marcaResultado(r.validoAceptado)} (${r.validoAceptado})`);
  console.log(`Segundo diagnostico bloqueado por UNIQUE: ${marcaResultado(r.duplicadoBloqueadoPorUnique)} (${r.duplicadoBloqueadoPorUnique})`);
  console.log(`Integridad final (exactamente un diagnostico propio): ${marcaResultado(r.integridadFinal)} (${r.integridadFinal})`);
  console.log(`Sesiones cerradas: ${marcaResultado(r.sesionesCerradas)} (${r.sesionesCerradas})`);
  console.log(`Resultado global: ${calcularResultadoGlobal(r)}`);
}

async function main() {
  console.log('Checkpoint 4 -- validacion y proteccion de diagnosticos (cliente publico autenticado, sin service_role).');
  console.log('No se registra ningun valor sensible en disco. Todo vive solo en esta terminal mientras el proceso corre.');

  const resultados = {
    precondicionLimpia: 'no_ejecutado',
    invalidoRechazadoPorCheck: 'no_ejecutado',
    usuarioBBloqueadoPorRLS: 'no_ejecutado',
    intentoAjenoNoCreoDiagnostico: 'no_ejecutado',
    validoAceptado: 'no_ejecutado',
    duplicadoBloqueadoPorUnique: 'no_ejecutado',
    integridadFinal: 'no_ejecutado',
    sesionesCerradas: 'exito',
  };

  let idA = null;
  let detenido = false;
  let huboSignOutFallido = false;

  // --- Pasos 1-6: Usuario A (precondicion + caso 1) ---
  console.log('\n--- Usuario A ---');
  const credencialesA = await pedirCredenciales('Usuario A');
  try {
    idA = await iniciarSesion('usuarioA-fase1', credencialesA);
    if (idA) {
      resultados.precondicionLimpia = await verificarPrecondicionLimpia();
      if (resultados.precondicionLimpia === 'exito') {
        resultados.invalidoRechazadoPorCheck = await probarInsertInvalidoConId(idA);
      } else {
        detenido = true;
      }
    } else {
      resultados.precondicionLimpia = 'error_tecnico';
      detenido = true;
    }
  } finally {
    if (!(await cerrarSesion('usuarioA-fase1'))) huboSignOutFallido = true;
  }

  // --- Pasos 7-11: Usuario B (caso 2, suplantacion) ---
  if (!detenido) {
    console.log('\n--- Usuario B ---');
    const credencialesB = await pedirCredenciales('Usuario B');
    try {
      const idB = await iniciarSesion('usuarioB', credencialesB);
      if (idB) {
        resultados.usuarioBBloqueadoPorRLS = await probarSuplantacion(idA);
        if (resultados.usuarioBBloqueadoPorRLS === 'fallo_critico') {
          detenido = true;
          console.log('\n[DETENCION] Fallo critico de aislamiento detectado. No se ejecutan mas operaciones de INSERT.');
        }
      } else {
        resultados.usuarioBBloqueadoPorRLS = 'error_tecnico';
      }
    } finally {
      if (!(await cerrarSesion('usuarioB'))) huboSignOutFallido = true;
    }
  }

  // --- Pasos 11-21: Usuario A otra vez (verificacion posterior, caso 3, caso 4, integridad final) ---
  if (!detenido) {
    console.log('\n--- Usuario A (segunda sesion) ---');
    try {
      const idA2 = await iniciarSesion('usuarioA-fase2', credencialesA);
      if (idA2) {
        // Pasos 12-13: ANTES de cualquier INSERT, verificar de forma
        // independiente (desde la propia sesion de Usuario A) que el
        // intento de suplantacion no dejo un diagnostico creado.
        const verifPostSuplantacion = await verificarAusenciaDeSuplantacion();
        resultados.intentoAjenoNoCreoDiagnostico = combinarResultadoSuplantacion(
          resultados.usuarioBBloqueadoPorRLS,
          verifPostSuplantacion
        );

        if (verifPostSuplantacion === 'fallo_critico') {
          // Paso 14: brecha critica -- no se ejecuta el diagnostico
          // valido ni el duplicado; ya no se imprimio contenido alguno.
          console.log(
            '\n[DETENCION] Se encontro un diagnostico ajeno tras el intento de suplantacion. ' +
              'No se ejecutan el diagnostico valido ni el duplicado.'
          );
        } else if (verifPostSuplantacion === 'error_tecnico') {
          console.log(
            '[usuarioA-fase2] No se pudo confirmar el estado tras la suplantacion (error tecnico); ' +
              'no se ejecutan el diagnostico valido ni el duplicado con esta incertidumbre pendiente.'
          );
        } else {
          // Paso 15 en adelante: solo si continua con exactamente 0 filas.
          resultados.validoAceptado = await probarInsertValido(idA2);
          resultados.duplicadoBloqueadoPorUnique = await probarSegundoInsertConId(idA2);
          resultados.integridadFinal = await verificarIntegridadFinal(idA2);
        }
      } else {
        resultados.validoAceptado = 'error_tecnico';
      }
    } finally {
      if (!(await cerrarSesion('usuarioA-fase2'))) huboSignOutFallido = true;
    }
  }

  // Un fallo de signOut, por si solo, no debe forzar NO APROBADO: se
  // clasifica como error_tecnico (INCONCLUSO), salvo que ya exista un
  // fallo funcional o brecha critica en otra comprobacion, en cuyo caso
  // el resultado global permanece NO APROBADO de todas formas (ver
  // calcularResultadoGlobal, que evalua "fallo"/"fallo_critico" con
  // prioridad sobre "error_tecnico" en cualquier campo).
  resultados.sesionesCerradas = huboSignOutFallido ? 'error_tecnico' : 'exito';

  // --- Paso 22: resumen ---
  mostrarResumen(resultados);

  rl.close();
}

main();
