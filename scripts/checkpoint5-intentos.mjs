#!/usr/bin/env node
// Utilidad temporal del Checkpoint 5 (batería funcional del Día 2, puntos
// 7-10). Verifica, contra el proyecto real de Supabase y usando
// EXCLUSIVAMENTE el cliente publico autenticado (nunca service_role):
//   - que public.ejercicios_respuestas no es legible por el cliente publico
//     (ni autenticado ni anonimo);
//   - que la RPC publica registrar_intento() acepta un intento valido para
//     el propio usuario;
//   - que el cliente no puede imponer el valor de "correcto": la firma real
//     de la funcion no acepta ese parametro (evidencia estatica, ya
//     confirmada), y ademas esta utilidad intenta una llamada real que
//     inyecta esa clave, con la expectativa de que PostgREST la rechace
//     antes de ejecutar el cuerpo de la funcion (comportamiento previsto;
//     solo se confirma con una ejecucion real futura -- ver documentacion
//     completa en scripts/lib/checkpoint5-logica.mjs);
//   - que registrar_intento() rechaza una invocacion sin sesion.
//
// No contiene correos, contrasenas, tokens ni UUID: todo se solicita en
// tiempo de ejecucion y vive solo en memoria mientras el proceso corre.
//
// Requiere NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
// ya definidas en el entorno (ver .env.local). Ejecutar con:
//   node --env-file=.env.local scripts/checkpoint5-intentos.mjs
//
// Es un script HERMANO de scripts/checkpoint2-auth-trigger.mjs,
// scripts/checkpoint3-rls-aislamiento.mjs y
// scripts/checkpoint4-diagnosticos.mjs -- ninguno de esos tres archivos fue
// modificado para crear este. Solo utiliza a Usuario Temporal A: ninguno de
// los cuatro controles de este checkpoint requiere una segunda identidad.
//
// ADVERTENCIA IMPORTANTE: una ejecucion real de este script CREA y
// CONSERVA un (1) intento de prueba para Usuario Temporal A en
// public.intentos (vía la RPC registrar_intento, nunca por INSERT
// directo). El script no lo elimina automaticamente -- igual que el
// Checkpoint 4 conserva su diagnostico de prueba como estado final.
//
// La logica de decision (clasificadores, construccion de la carga de la
// RPC, y la orquestacion completa de los cuatro controles) vive en
// scripts/lib/checkpoint5-logica.mjs, con TODAS las llamadas de red
// inyectadas como dependencias -- esto es lo que permite probarla con
// node --test, con dobles locales, sin tocar este archivo ni contactar
// Supabase. Este archivo es la UNICA pieza que de verdad usa
// https/readline/el cliente real de Supabase.

import { createClient } from '@supabase/supabase-js';
import readline from 'node:readline/promises';
import { clearLine, cursorTo } from 'node:readline';
import { stdin, stdout } from 'node:process';
import https from 'node:https';
import { URL as NodeURL } from 'node:url';

import {
  configuracionPublicaCompleta,
  maskEmail,
  shortId,
  marcaResultado,
  calcularResultadoGlobal,
  ejecutarCheckpoint5,
} from './lib/checkpoint5-logica.mjs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!configuracionPublicaCompleta(SUPABASE_URL, SUPABASE_KEY)) {
  console.error(
    '[ERROR] Faltan NEXT_PUBLIC_SUPABASE_URL y/o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY en el entorno.\n' +
      'Completa .env.local y ejecuta con: node --env-file=.env.local scripts/checkpoint5-intentos.mjs'
  );
  process.exit(1);
}

// ============================================================
// Copia literal (sin cambios de comportamiento) de
// scripts/checkpoint4-diagnosticos.mjs: SimpleHeaders, SimpleResponse,
// nodeHttpsFetch, askHidden(), reportError(). Ver ese archivo (o
// checkpoint2-auth-trigger.mjs / checkpoint3-rls-aislamiento.mjs, donde se
// corrigieron originalmente) para el detalle de por que existen.
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

// Enmascara SIEMPRE cada caracter con "*" en pantalla, sin importar si la
// terminal es un TTY real (isTTY controla solo detalles cosmeticos del
// modo raw/backspace) -- la contrasena real nunca se imprime en ningun
// escenario, por lo que este mecanismo ya cumple "ocultarla si el entorno
// lo permite" sin necesitar una rama adicional que aborte por falta de
// TTY.
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

// IMPORTANTE (sanitizacion): identico criterio que en
// scripts/checkpoint4-diagnosticos.mjs -- "details"/"hint" de
// PostgrestError NUNCA se leen ni se imprimen, porque el campo DETAIL de
// Postgres para violaciones reales puede incluir valores de columna. Solo
// se muestran "message"/"status"/"code" (y la cadena de "cause" para
// errores de transporte).
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
        `errno: ${cause.errno ?? 'n/d'}, mensaje: ${cause.message ?? 'n/d'}`
    );
    cause = cause.cause;
    nivel += 1;
  }
}

// ============================================================
// Wiring real de Supabase (unico lugar del proyecto donde este archivo
// realmente contacta la red) -- cada funcion es la implementacion real de
// una dependencia inyectada en ejecutarCheckpoint5().
// ============================================================

let credencialesA = null;

async function pedirCredenciales(etiqueta) {
  const email = await ask(`Correo de ${etiqueta}: `);
  const password = await askHidden(`Contrasena de ${etiqueta} (oculta): `);
  return { email, password };
}

async function iniciarSesionA() {
  const { data, error } = await supabase.auth.signInWithPassword(credencialesA);
  if (error) {
    reportError('login-usuarioA', error);
    return null;
  }
  console.log('[login-usuarioA] Sesion iniciada.');
  console.log(`  id: ${shortId(data.user?.id)}`);
  console.log(`  correo: ${maskEmail(data.user?.email)}`);
  return data.user?.id ?? null;
}

async function cerrarSesion() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    reportError('signOut-usuarioA', error);
    return false;
  }
  console.log('[signOut-usuarioA] Sesion cerrada.');
  return true;
}

// CONTROL 1: jamas se imprime "data" -- si la fuga ocurriera, contendria
// la respuesta correcta real. Solo se le pasa al clasificador puro.
async function seleccionarEjerciciosRespuestas() {
  const { data, error } = await supabase.from('ejercicios_respuestas').select('ejercicio_id, respuesta_correcta').limit(1);
  if (error) reportError('control1-lectura-protegida', error);
  return { data, error };
}

// Precondicion + eleccion de ejercicio: SOLO columnas que nunca incluyen
// la respuesta correcta (ver contrato documentado en
// scripts/lib/checkpoint5-logica.mjs).
async function seleccionarEjerciciosDisponibles() {
  const { data, error } = await supabase
    .from('ejercicios')
    .select('id, materia, nivel_dificultad')
    .order('materia', { ascending: true })
    .order('nivel_dificultad', { ascending: true })
    .limit(1);
  if (error) reportError('precondicion-ejercicio', error);
  return { data, error };
}

// CONTROL 2 (y base de Control 3): unica via de escritura permitida, la
// RPC publica -- nunca un INSERT directo en intentos.
async function registrarIntento(carga) {
  const { data, error } = await supabase.rpc('registrar_intento', carga);
  if (error) reportError('control2-registro-valido', error);
  return { data, error };
}

// CONTROL 3 (comportamiento previsto, no solo evidencia estatica): intento
// deliberado de inyectar una clave "correcto" ajena a la firma real de
// registrar_intento(p_ejercicio_id, p_respuesta_dada, p_tiempo_respuesta).
// PostgREST resuelve llamadas RPC por nombre de parametro: se espera que
// una clave adicional ajena a la firma real haga que no encuentre ninguna
// sobrecarga compatible y rechace la llamada COMPLETA (codigo PGRST202,
// ver scripts/lib/checkpoint5-logica.mjs) antes de ejecutar el cuerpo de
// la funcion -- nunca deberia llegar a auth.uid(), nunca deberia insertar
// nada. Esta expectativa solo queda confirmada cuando esta utilidad se
// ejecute una vez, realmente, contra Supabase.
async function registrarIntentoManipulado(carga) {
  const { data, error } = await supabase.rpc('registrar_intento', carga);
  if (error) reportError('control3-parametro-manipulado', error);
  return { data, error };
}

async function seleccionarIntentosPropios() {
  const { data, error } = await supabase.from('intentos').select('id, usuario_id');
  if (error) reportError('lectura-intentos-propios', error);
  return { data, error };
}

// CONTROL 4: se invoca DESPUES de cerrar la sesion de Usuario A (ya
// ocurrido en el flujo de ejecutarCheckpoint5 antes de llegar aqui), con
// el MISMO cliente publico -- lo que hace este intento realmente anonimo
// es la ausencia de sesion activa (auth.uid() sera NULL en el servidor), no
// un cliente distinto.
async function registrarIntentoAnonimo(carga) {
  const { data, error } = await supabase.rpc('registrar_intento', carga);
  if (error) reportError('control4-rechazo-sin-auth', error);
  return { data, error };
}

function mostrarResumen(r) {
  console.log('\n=== RESUMEN CHECKPOINT 5 -- proteccion de respuestas oficiales y registro server-side de intentos ===');
  console.log(`Lectura directa de ejercicios_respuestas rechazada: ${marcaResultado(r.lecturaProtegidaRechazada)} (${r.lecturaProtegidaRechazada})`);
  console.log(`Precondicion: existe al menos un ejercicio disponible: ${marcaResultado(r.precondicionEjercicioDisponible)} (${r.precondicionEjercicioDisponible})`);
  console.log(`Registro valido aceptado via registrar_intento(): ${marcaResultado(r.registroValidoAceptado)} (${r.registroValidoAceptado})`);
  console.log(`Propiedad del intento confirmada (RLS, propio usuario): ${marcaResultado(r.propiedadIntentoConfirmada)} (${r.propiedadIntentoConfirmada})`);
  console.log(`Calculo de "correcto" sin parametro controlable por el cliente: ${marcaResultado(r.calculoServidorSinParametroCliente)} (${r.calculoServidorSinParametroCliente})`);
  console.log(`Rechazo de registrar_intento() sin autenticacion: ${marcaResultado(r.rechazoSinAutenticacion)} (${r.rechazoSinAutenticacion})`);
  console.log(`Sesiones cerradas: ${marcaResultado(r.sesionesCerradas)} (${r.sesionesCerradas})`);
  const resultadoGlobal = calcularResultadoGlobal(r);
  console.log(`Resultado global: ${resultadoGlobal}`);
  return resultadoGlobal;
}

async function main() {
  console.log('Checkpoint 5 -- proteccion de respuestas oficiales y registro server-side de intentos (cliente publico, sin service_role).');
  console.log('No se registra ningun valor sensible en disco. Todo vive solo en esta terminal mientras el proceso corre.');
  console.log(
    'ADVERTENCIA: una ejecucion real de este script CREA y CONSERVA un (1) intento de prueba para Usuario Temporal A ' +
      'en public.intentos (via la RPC registrar_intento, nunca por INSERT directo). No se elimina automaticamente.'
  );

  console.log('\n--- Usuario Temporal A ---');
  credencialesA = await pedirCredenciales('Usuario Temporal A');

  const resultados = await ejecutarCheckpoint5({
    iniciarSesionA,
    cerrarSesion,
    seleccionarEjerciciosRespuestas,
    seleccionarEjerciciosDisponibles,
    registrarIntento,
    registrarIntentoManipulado,
    seleccionarIntentosPropios,
    registrarIntentoAnonimo,
  });

  const resultadoGlobal = mostrarResumen(resultados);
  rl.close();
  process.exitCode = resultadoGlobal === 'APROBADO' ? 0 : 1;
}

main();
