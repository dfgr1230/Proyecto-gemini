#!/usr/bin/env node
// Utilidad temporal del Checkpoint 3 (Fase 2 - Dia 2).
// Verifica, contra el proyecto real de Supabase y usando EXCLUSIVAMENTE
// el cliente publico autenticado (nunca service_role), que la politica
// RLS "usuarios_select_propio" aisla correctamente los perfiles: cada
// usuario puede leer su propia fila y NINGUNO puede leer la del otro.
//
// No contiene correos, contrasenas, tokens ni UUID: todo se solicita en
// tiempo de ejecucion y vive solo en memoria mientras el proceso corre.
//
// Requiere NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
// ya definidas en el entorno (ver .env.local -- este es el nombre real
// de la clave publica de este proyecto; ver la nota mas abajo, junto a
// la constante SUPABASE_KEY, sobre por que no se usa
// NEXT_PUBLIC_SUPABASE_ANON_KEY). Ejecutar con:
//   node --env-file=.env.local scripts/checkpoint3-rls-aislamiento.mjs
//
// Es un script HERMANO de scripts/checkpoint2-auth-trigger.mjs, no una
// ampliacion de este: la semantica de "0 filas" es opuesta entre ambos
// (en Checkpoint 2, 0 filas en el perfil propio es una falla; aqui, 0
// filas en una consulta cruzada es el resultado CORRECTO). Mezclar
// ambas semanticas en un mismo menu/letra se presto a confusion, por
// eso se mantienen separados. checkpoint2-auth-trigger.mjs no fue
// modificado para crear este archivo.

import { createClient } from '@supabase/supabase-js';
import readline from 'node:readline/promises';
import { clearLine, cursorTo } from 'node:readline';
import { stdin, stdout } from 'node:process';
import https from 'node:https';
import { URL as NodeURL } from 'node:url';

// NOTA sobre el nombre de la variable: el diseno original de este
// checkpoint menciona NEXT_PUBLIC_SUPABASE_ANON_KEY, pero ese nombre no
// existe en este proyecto -- se reemplazo deliberadamente por
// NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY en .env.example/.env.local y en
// scripts/checkpoint2-auth-trigger.mjs (Publishable key moderna,
// sb_publishable_...). Se usa aqui el mismo nombre real para no romper
// la convencion ya establecida ni tocar .env.local.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    '[ERROR] Faltan NEXT_PUBLIC_SUPABASE_URL y/o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY en el entorno.\n' +
      'Completa .env.local y ejecuta con: node --env-file=.env.local scripts/checkpoint3-rls-aislamiento.mjs'
  );
  process.exit(1);
}

// ============================================================
// A partir de aqui: SimpleHeaders, SimpleResponse y nodeHttpsFetch son
// una copia literal (sin cambios) de scripts/checkpoint2-auth-trigger.mjs,
// ya probada en ese checkpoint. Ver ese archivo para el detalle completo
// de por que existen (evitar fetch/Undici + preservar apikey/Authorization
// cuando el SDK los entrega como Headers nativo).
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

// Codigos de control por numero (ver explicacion completa en
// checkpoint2-auth-trigger.mjs): 3 = Ctrl+C, 4 = Ctrl+D/EOF,
// 8 = backspace, 127 = del.
const CODE_CTRL_C = 3;
const CODE_CTRL_D = 4;
const CODE_BACKSPACE = 8;
const CODE_DEL = 127;

// Copia literal de askHidden() (incluye la correccion de stdin.resume()
// ya validada en Checkpoint 2).
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

function reportError(label, error) {
  if (!error) {
    console.log(`[${label}] Sin error.`);
    return;
  }
  console.log(`[${label}] Error controlado -> status: ${error.status ?? 'n/d'}, mensaje: ${error.message}`);

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
// Logica especifica de Checkpoint 3 (no existe en checkpoint2).
// ============================================================

async function pedirCredenciales(etiqueta) {
  const email = await ask(`Correo de ${etiqueta}: `);
  const password = await askHidden(`Contrasena de ${etiqueta} (oculta): `);
  return { email, password };
}

// Inicia sesion y devuelve SOLO el id completo (uso interno, nunca
// impreso completo) o null si fallo. El id se necesita en memoria para
// poder construir despues el filtro .eq('id', idDelOtro) de la consulta
// cruzada.
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

async function cerrarSesion(etiqueta) {
  const { error } = await supabase.auth.signOut();
  if (error) {
    reportError(`signOut-${etiqueta}`, error);
    return;
  }
  console.log(`[signOut-${etiqueta}] Sesion cerrada.`);
}

// Consulta SIN filtro explicito (RLS ya restringe a la fila propia).
// Exito = exactamente 1 fila, cuyo id coincide con el de la sesion.
async function consultarPerfilPropio(etiqueta, idDeLaSesion) {
  const { data, error } = await supabase.from('usuarios').select('id, nombre, email, fecha_registro');

  if (error) {
    reportError(`perfil-propio-${etiqueta}`, error);
    return 'error_tecnico';
  }
  if (!data || data.length === 0) {
    console.log(`[perfil-propio-${etiqueta}] FALLO: 0 filas devueltas (se esperaba exactamente 1).`);
    return 'fallo';
  }
  if (data.length > 1) {
    console.log(`[perfil-propio-${etiqueta}] FALLO: se devolvieron ${data.length} filas (se esperaba 1).`);
    return 'fallo';
  }

  const fila = data[0];
  const coincide = fila.id === idDeLaSesion;
  console.log(`[perfil-propio-${etiqueta}] 1 fila devuelta. id coincide con la sesion: ${coincide ? 'si' : 'NO'}.`);
  console.log(`  id: ${shortId(fila.id)}`);
  console.log(`  correo: ${maskEmail(fila.email)}`);
  return coincide ? 'exito' : 'fallo';
}

// Consulta CON filtro explicito por el id de la OTRA identidad, usando
// la sesion actual (de un usuario distinto al dueno de ese id). Exito =
// 0 filas SIN error (RLS bloqueo correctamente). Una fila devuelta es
// un fallo CRITICO de aislamiento: se reporta sin imprimir su contenido.
// No se usa maybeSingle(): se inspeccionan data/error explicitamente
// para distinguir "bloqueo correcto" (0 filas) de "error tecnico".
async function consultarPerfilAjeno(etiqueta, idAjeno) {
  const { data, error } = await supabase.from('usuarios').select('id, nombre, email, fecha_registro').eq('id', idAjeno);

  if (error) {
    reportError(`perfil-ajeno-${etiqueta}`, error);
    return 'error_tecnico';
  }
  if (!data || data.length === 0) {
    console.log(`[perfil-ajeno-${etiqueta}] Bloqueo correcto: 0 filas devueltas.`);
    return 'exito';
  }

  console.log(
    `[perfil-ajeno-${etiqueta}] FALLO CRITICO DE AISLAMIENTO: se devolvio ${data.length} fila(s) ajena(s). ` +
      'No se imprime su contenido.'
  );
  return 'fallo_critico';
}

function marcaResultado(v) {
  if (v === 'exito') return '✅';
  if (v === 'fallo' || v === 'fallo_critico') return '❌';
  return '⚠️'; // error_tecnico o no_ejecutado
}

function mostrarResumen(r) {
  console.log('\n=== RESUMEN CHECKPOINT 3 -- aislamiento RLS ===');
  console.log(`Usuario 1 -> perfil propio: ${marcaResultado(r.usuario1Propio)} (${r.usuario1Propio})`);
  console.log(
    `Usuario 1 -> perfil de Usuario 2 bloqueado: ${marcaResultado(r.usuario1BloqueaUsuario2)} (${r.usuario1BloqueaUsuario2})`
  );
  console.log(`Usuario 2 -> perfil propio: ${marcaResultado(r.usuario2Propio)} (${r.usuario2Propio})`);
  console.log(
    `Usuario 2 -> perfil de Usuario 1 bloqueado: ${marcaResultado(r.usuario2BloqueaUsuario1)} (${r.usuario2BloqueaUsuario1})`
  );

  const valores = Object.values(r);
  let global;
  if (valores.includes('fallo_critico') || valores.includes('fallo')) {
    global = 'NO APROBADO';
  } else if (valores.includes('error_tecnico') || valores.includes('no_ejecutado')) {
    global = 'INCONCLUSO';
  } else {
    global = 'APROBADO';
  }
  console.log(`Resultado global: ${global}`);
}

async function main() {
  console.log('Checkpoint 3 -- aislamiento de perfiles mediante RLS (cliente publico autenticado, sin service_role).');
  console.log('No se registra ningun valor sensible en disco. Todo vive solo en esta terminal mientras el proceso corre.');

  const resultados = {
    usuario1Propio: 'no_ejecutado',
    usuario1BloqueaUsuario2: 'no_ejecutado',
    usuario2Propio: 'no_ejecutado',
    usuario2BloqueaUsuario1: 'no_ejecutado',
  };
  let detenidoPorFalloCritico = false;

  // --- Pasos 1-5: Usuario 1 ---
  console.log('\n--- Usuario 1 ---');
  const credencialesUsuario1 = await pedirCredenciales('Usuario 1');
  const idUsuario1 = await iniciarSesion('usuario1', credencialesUsuario1);
  if (idUsuario1) {
    resultados.usuario1Propio = await consultarPerfilPropio('usuario1', idUsuario1);
  }
  await cerrarSesion('usuario1');

  // --- Pasos 6-11: Usuario 2, incluye consulta cruzada hacia Usuario 1 ---
  console.log('\n--- Usuario 2 ---');
  const credencialesUsuario2 = await pedirCredenciales('Usuario 2');
  const idUsuario2 = await iniciarSesion('usuario2', credencialesUsuario2);
  if (idUsuario2) {
    resultados.usuario2Propio = await consultarPerfilPropio('usuario2', idUsuario2);

    if (idUsuario1) {
      resultados.usuario2BloqueaUsuario1 = await consultarPerfilAjeno('usuario2-ve-usuario1', idUsuario1);
      if (resultados.usuario2BloqueaUsuario1 === 'fallo_critico') {
        detenidoPorFalloCritico = true;
        console.log('\n[DETENCION] Fallo critico de aislamiento detectado. No se ejecutan mas consultas.');
      }
    }
  }
  await cerrarSesion('usuario2');

  // --- Pasos 12-14: Usuario 1 otra vez (credenciales ya en memoria), consulta cruzada hacia Usuario 2 ---
  if (!detenidoPorFalloCritico && idUsuario2) {
    console.log('\n--- Usuario 1 (segunda sesion) ---');
    const idUsuario1OtraVez = await iniciarSesion('usuario1-otra-vez', credencialesUsuario1);
    if (idUsuario1OtraVez) {
      resultados.usuario1BloqueaUsuario2 = await consultarPerfilAjeno('usuario1-ve-usuario2', idUsuario2);
      if (resultados.usuario1BloqueaUsuario2 === 'fallo_critico') {
        console.log('\n[DETENCION] Fallo critico de aislamiento detectado.');
      }
    }
    await cerrarSesion('usuario1-otra-vez');
  }

  // --- Paso 15: resumen ---
  mostrarResumen(resultados);

  rl.close();
}

main();
