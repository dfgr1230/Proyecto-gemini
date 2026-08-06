#!/usr/bin/env node
// Utilidad temporal y reproducible del Checkpoint 2 (Fase 2 - Dia 2).
// Verifica, contra el proyecto real de Supabase, que signUp() + Confirm
// email + el trigger on_auth_user_created + la politica RLS de lectura
// propia se comportan como fueron disenados. No contiene correos,
// contrasenas, tokens ni claves: todo se solicita en tiempo de ejecucion.
//
// Requiere NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
// ya definidas en el entorno (ver .env.local). Ejecutar con:
//   node --env-file=.env.local scripts/checkpoint2-auth-trigger.mjs
//
// No persiste ninguna sesion en disco entre ejecuciones: la sesion vive
// solo en memoria mientras el proceso esta corriendo. Cierra el proceso
// (Ctrl+C) en cualquier momento sin dejar rastros; para reanudar, vuelve
// a ejecutar el script y repite el paso que corresponda.

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
      'Completa .env.local y ejecuta con: node --env-file=.env.local scripts/checkpoint2-auth-trigger.mjs'
  );
  process.exit(1);
}

// Adaptador fetch minimo sobre node:https, para evitar por completo el
// motor fetch/Undici integrado en Node (diagnosticado como la causa real
// de "fetch failed" / UND_ERR_CONNECT_TIMEOUT en este equipo -- DNS, TLS
// directo y curl.exe si funcionan). No cambia la validacion TLS (no se
// toca rejectUnauthorized, por lo que Node mantiene su verificacion por
// defecto) y no usa ningun agente inseguro. No reemplaza globalThis.fetch:
// se inyecta unicamente en este cliente de Supabase, mas abajo, via
// options.global.fetch.
class SimpleHeaders {
  constructor(init) {
    this._map = new Map();
    if (init) this.mergeFrom(init);
  }
  // Absorbe encabezados de CUALQUIERA de las formas que el SDK instalado
  // realmente usa, sobreescribiendo por nombre (case-insensitive) sobre
  // lo que ya hubiera -- asi permite aplicar "encima" un segundo origen
  // (p.ej. init.headers sobre input.headers) simplemente llamando de
  // nuevo a mergeFrom().
  //
  // Caso critico que motivo este cambio: @supabase/supabase-js envuelve
  // el fetch personalizado con fetchWithAuth() (ver
  // node_modules/@supabase/supabase-js/src/lib/fetch.ts), que construye
  // un Headers NATIVO (`new Headers(init?.headers)`), le agrega apikey/
  // Authorization, y llama a fetch(input, { ...init, headers }) con ese
  // Headers nativo como init.headers. Un Headers nativo NO tiene
  // propiedades propias enumerables -- Object.entries(headersNativo)
  // devuelve [] -- asi que la version anterior de este constructor
  // perdia apikey y Authorization en silencio para cualquier llamada que
  // pasara por fetchWithAuth() (el caso de PostgREST / .from(), no el de
  // Auth, que arma sus headers como objeto plano). La deteccion por
  // Symbol.iterator cubre Headers nativo, Map y arrays de pares por
  // igual, sin necesitar casos especiales por clase.
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

// Contrato compatible con el "Fetch" que espera @supabase/auth-js y
// @supabase/postgrest-js en esta version instalada: acepta (url, init) o
// un objeto tipo Request como primer argumento; entiende method, headers,
// body y signal/AbortSignal; devuelve un objeto con status, statusText,
// ok, headers.get(...) y json()/text() -- lo que ambos paquetes usan
// (ver looksLikeFetchResponse() y parseResponseAPIVersion() en
// @supabase/auth-js/lib/helpers.ts, y res.headers.get(...) en
// @supabase/postgrest-js/PostgrestBuilder.ts).
function nodeHttpsFetch(input, init = {}) {
  return new Promise((resolve, reject) => {
    let urlObj;
    let method = init.method;
    let bodyInput = init.body;
    let signal = init.signal;

    // Encabezados: primero los del Request de entrada (si input lo es),
    // como base; despues los de init ENCIMA, con precedencia (asi es
    // como fetchWithAuth() los usa: agrega apikey/Authorization ya
    // resueltos sobre lo que hubiera en init.headers y llama con eso).
    const headers = new SimpleHeaders();

    if (input && typeof input === 'object' && typeof input.url === 'string') {
      // Objeto tipo Request.
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

    // Sin rejectUnauthorized ni agente propio: se conserva la
    // verificacion de certificados por defecto de Node (segura).
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
      // Se propaga el error real de node:https (name/message/code/errno),
      // sin envolverlo ni descartar informacion.
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

// Estado en memoria unicamente (nunca se escribe a disco).
let currentEmail = null;

const rl = readline.createInterface({ input: stdin, output: stdout });

async function ask(promptText) {
  return (await rl.question(promptText)).trim();
}

// Codigos de control por numero (evita incrustar bytes de control crudos
// en el archivo fuente, fragiles ante editores y conversion de saltos de
// linea): 3 = Ctrl+C, 4 = Ctrl+D/EOF, 8 = backspace, 127 = del.
const CODE_CTRL_C = 3;
const CODE_CTRL_D = 4;
const CODE_BACKSPACE = 8;
const CODE_DEL = 127;

// Lee una linea con retroalimentacion visual de asteriscos, sin revelar
// jamas el caracter real (para contrasenas).
//
// La interfaz "rl" (compartida con ask()) activa su propio manejo interno
// de teclas ("keypress") apenas se crea, porque stdout es un TTY. Ese
// manejo interno es justamente lo que redibujaria cada tecla en pantalla
// tal como fue tecleada (asi es como readline soporta backspace/flechas).
// Por eso se retiran temporalmente esos listeners mientras se lee la
// contrasena en modo crudo, sustituyendo el eco real por un asterisco por
// caracter, y se reinstalan al terminar para que las preguntas normales
// sigan funcionando igual.
async function askHidden(promptText) {
  stdout.write(promptText);

  const savedKeypressListeners = stdin.listeners('keypress');
  stdin.removeAllListeners('keypress');

  const wasRaw = stdin.isRaw;
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  // IMPORTANTE: se debe dejar stdin fluyendo (resume), no pausado. "rl"
  // (el propietario normal de stdin) no vuelve a llamar resume() por su
  // cuenta -- el solo hecho de reinstalar sus listeners de "keypress" no
  // reactiva el flujo (a diferencia de un listener de "data", "keypress"
  // no dispara el modo flowing automatico de Node). Dejar stdin pausado
  // aqui es justamente lo que causaba que, tras un askHidden() exitoso,
  // el siguiente rl.question() del menu se quedara esperando sobre un
  // stream inerte: sin nada que lo mantuviera "vivo", Node vaciaba el
  // event loop y el proceso terminaba solo, abandonando esa promesa
  // pendiente -- sin llegar a leer la letra de la siguiente opcion.
  const restoreTerminal = () => {
    if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
    for (const fn of savedKeypressListeners) stdin.on('keypress', fn);
    stdin.resume();
  };

  // Al terminar (Enter o Ctrl+C), borra la linea de asteriscos y la
  // reemplaza por un marcador de texto fijo -- asi ni la pantalla ni el
  // scrollback conservan la cantidad exacta de caracteres tecleados.
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

// Mapea codigos tecnicos de bajo nivel a una categoria legible, sin
// exponer nada sensible (son codigos de sistema/red, no datos de usuario).
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
  // Solo nombre, mensaje, status/codigo y la cadena de "cause" (sin headers,
  // tokens, ni objetos completos de sesion/respuesta).
  console.log(`[${label}] Error controlado -> status: ${error.status ?? 'n/d'}, mensaje: ${error.message}`);

  let cause = error.cause;
  let nivel = 1;
  let huboCause = false;
  while (cause && nivel <= 3) {
    huboCause = true;
    console.log(
      `  causa nivel ${nivel} -> name: ${cause.name ?? 'n/d'}, code: ${cause.code ?? 'n/d'}, ` +
        `errno: ${cause.errno ?? 'n/d'}, mensaje: ${cause.message ?? 'n/d'}, ` +
        `categoria: ${categorizarCodigo(cause.code)}`
    );
    cause = cause.cause;
    nivel += 1;
  }

  // "AuthRetryableFetchError" (la clase que usa @supabase/auth-js para
  // cualquier fallo de fetch() sin respuesta HTTP) construye el mensaje
  // solo con el ".message" del error original y NUNCA adjunta ".cause":
  // ver node_modules/@supabase/auth-js/src/lib/fetch.ts, catch de
  // _handleRequest(). La causa real (DNS/TLS/timeout/etc.) se descarta
  // ahi mismo, antes de que este script pueda inspeccionarla -- no es
  // algo que reportError() pueda recuperar despues. Para esos casos, usa
  // la opcion H del menu (diagnostico de conectividad), que hace un
  // fetch() directo sin pasar por el SDK y por lo tanto SI conserva la
  // causa real.
  if (!huboCause && error.constructor?.name === 'AuthRetryableFetchError') {
    console.log(
      '  [nota] El SDK no adjunta la causa de red original a este tipo de error ' +
        '(revisar @supabase/auth-js/lib/fetch.ts). Usa la opcion H del menu para ' +
        'un diagnostico de conectividad con la causa real.'
    );
  }
}

async function pasoA_registrar() {
  const email = await ask('Correo temporal: ');
  const nombre = await ask('Nombre temporal: ');
  const password = await askHidden('Contrasena temporal (oculta): ');

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { nombre } },
  });

  if (error) {
    reportError('signUp', error);
    return;
  }

  currentEmail = email;
  console.log('[signUp] Solicitud aceptada. Se disparo el flujo de confirmacion por correo.');
  console.log(`  id: ${shortId(data.user?.id)}`);
  console.log(`  correo: ${maskEmail(data.user?.email)}`);
  console.log(`  nombre (metadata enviada): ${nombre}`);
  console.log(`  confirmado ya: ${data.user?.email_confirmed_at ? 'si (inesperado)' : 'no (esperado)'}`);
}

async function intentarLogin(etiqueta) {
  const email = await ask('Correo: ');
  const password = await askHidden('Contrasena (oculta): ');

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    reportError(etiqueta, error);
    return { ok: false };
  }

  currentEmail = email;
  console.log(`[${etiqueta}] Inicio de sesion exitoso.`);
  console.log(`  id: ${shortId(data.user?.id)}`);
  console.log(`  correo: ${maskEmail(data.user?.email)}`);
  return { ok: true };
}

async function pasoB_loginAntesDeConfirmar() {
  const { ok } = await intentarLogin('login-antes-de-confirmar');
  if (ok) {
    console.log(
      '[ADVERTENCIA] El login funciono antes de confirmar el correo. Esto no coincide con Confirm email activado — revisar configuracion.'
    );
    await supabase.auth.signOut();
  } else {
    console.log('Comportamiento esperado: sin sesion mientras el correo no este confirmado.');
  }
}

async function pasoC_pausa() {
  console.log('Revisa la bandeja de entrada del correo temporal y haz clic en el enlace de confirmacion de Supabase.');
  await ask('Presiona Enter cuando ya hayas confirmado el correo...');
}

async function pasoD_loginDespuesDeConfirmar() {
  await intentarLogin('login-despues-de-confirmar');
}

async function pasoE_getUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    reportError('auth.getUser', error);
    return;
  }
  console.log('[auth.getUser] Identidad actual:');
  console.log(`  id: ${shortId(data.user?.id)}`);
  console.log(`  correo: ${maskEmail(data.user?.email)}`);
  console.log(`  correo confirmado: ${data.user?.email_confirmed_at ? 'si' : 'no'}`);
}

async function pasoF_perfilPropio() {
  const { data, error } = await supabase
    .from('usuarios')
    .select('id, nombre, email, fecha_registro');

  if (error) {
    reportError('select usuarios', error);
    return;
  }

  if (!data || data.length === 0) {
    console.log('[usuarios] Ninguna fila devuelta (revisar si el trigger se ejecuto o si hay sesion activa).');
    return;
  }
  if (data.length > 1) {
    console.log(`[ADVERTENCIA] Se devolvio mas de una fila (${data.length}) — no deberia ocurrir bajo RLS.`);
  }

  const { data: authData } = await supabase.auth.getUser();

  for (const fila of data) {
    const coincideId = authData.user?.id === fila.id;
    const coincideEmail = authData.user?.email === fila.email;
    console.log('[usuarios] Fila propia encontrada:');
    console.log(`  id: ${shortId(fila.id)} (coincide con sesion: ${coincideId ? 'si' : 'NO'})`);
    console.log(`  nombre: ${fila.nombre}`);
    console.log(`  correo: ${maskEmail(fila.email)} (coincide con sesion: ${coincideEmail ? 'si' : 'NO'})`);
    console.log(`  fecha_registro: ${fila.fecha_registro}`);
  }
}

// Diagnostico de conectividad puro: NO pide correo/nombre/contrasena, NO
// llama a signUp/signIn ni a ningun metodo de supabase.auth, y NO envia
// la Publishable key (usa nodeHttpsFetch directo -- el mismo adaptador
// node:https que recibe el cliente de Supabase mas arriba -- sin pasar
// por el cliente de Supabase). Ya no usa fetch/Undici en absoluto.
async function pasoH_diagnosticoConectividad() {
  const objetivo = `${SUPABASE_URL}/auth/v1/health`;
  console.log('[diagnostico] Probando conectividad (node:https, sin fetch/Undici, sin credenciales, GET simple)...');
  try {
    const inicio = Date.now();
    const res = await nodeHttpsFetch(objetivo, { method: 'GET' });
    const duracionMs = Date.now() - inicio;
    console.log('[diagnostico] Respuesta HTTP recibida -> conexion completa (TLS + HTTP OK).');
    console.log(`  status: ${res.status}`);
    console.log(`  duracion: ${duracionMs} ms`);
  } catch (err) {
    console.log('[diagnostico] La conexion fallo antes de recibir una respuesta HTTP.');
    reportError('diagnostico-conectividad', err);
  }
}

async function pasoG_cerrarSesion() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    reportError('signOut', error);
    return;
  }
  currentEmail = null;
  console.log('[signOut] Sesion cerrada.');
}

function menuTexto(estado) {
  return `
Checkpoint 2 -- autenticacion y trigger de creacion de perfiles
Ejecuta un usuario temporal por vez, en este orden:

  A) Registrar usuario (signUp)
  B) Intentar login ANTES de confirmar (debe fallar)
  C) Pausa: confirmar correo manualmente
  D) Login DESPUES de confirmar (debe funcionar)
  E) auth.getUser()
  F) Consultar perfil propio en public.usuarios
  G) Cerrar sesion
  H) Diagnostico de conectividad (sin datos, sin llamadas de Auth)
  Q) Salir

Sesion actual: ${estado}
Opcion: `;
}

async function main() {
  console.log('No se registra ningun valor sensible en disco. Todo vive solo en esta terminal mientras el proceso corre.');
  let salir = false;
  while (!salir) {
    const estado = currentEmail ? maskEmail(currentEmail) : '(sin sesion)';
    const opcion = (await ask(menuTexto(estado))).trim().toUpperCase();
    try {
      switch (opcion) {
        case 'A':
          await pasoA_registrar();
          break;
        case 'B':
          await pasoB_loginAntesDeConfirmar();
          break;
        case 'C':
          await pasoC_pausa();
          break;
        case 'D':
          await pasoD_loginDespuesDeConfirmar();
          break;
        case 'E':
          await pasoE_getUser();
          break;
        case 'F':
          await pasoF_perfilPropio();
          break;
        case 'G':
          await pasoG_cerrarSesion();
          break;
        case 'H':
          await pasoH_diagnosticoConectividad();
          break;
        case 'Q':
          salir = true;
          break;
        default:
          console.log('Opcion no reconocida.');
      }
    } catch (err) {
      console.log(`[EXCEPCION] ${err?.message ?? err}`);
    }
  }
  rl.close();
  console.log('Fin. Repite todo el menu (A-G) para el segundo usuario temporal, en una nueva ejecucion.');
}

main();
