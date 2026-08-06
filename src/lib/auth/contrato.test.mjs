// Pruebas locales del contrato de registro/login. SIN RED, SIN Supabase
// real: usan node:test + node:assert (nativos de Node, sin instalar
// nada) y dobles locales para signUp/signInWithPassword. Se ejecutan
// con:
//   node --test src/lib/auth/contrato.test.mjs
//
// El archivo probado es contrato.ts (TypeScript) -- Node 22 lo ejecuta
// directamente via type-stripping nativo, sin compilar. La extension
// ".ts" es obligatoria aqui porque el loader de Node no resuelve
// especificadores relativos sin extension; TypeScript nunca typechequea
// este archivo (no es .ts/.tsx/.mts), asi que esa extension explicita
// no entra en conflicto con next build / tsc.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  validarNombre,
  validarEmail,
  validarConfirmacionPassword,
  validarFormularioRegistro,
  construirCargaSignUp,
  clasificarErrorRegistro,
  clasificarErrorLogin,
  ejecutarRegistro,
  ejecutarLogin,
  clasificarErrorConfirmacion,
  interpretarResultadoConfirmacion,
  ejecutarConfirmacion,
  construirCargaResend,
  clasificarErrorReenvio,
  ejecutarReenvio,
} from './contrato.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..', '..');

const DATOS_VALIDOS_FICTICIOS = Object.freeze({
  nombre: 'Usuario Temporal',
  email: 'usuario-temporal@example.invalid',
  password: 'contrasena-ficticia-123',
  confirmarPassword: 'contrasena-ficticia-123',
});

// ============================================================
// 3/4: el formulario exige "nombre"; vacio o solo espacios se rechaza.
// ============================================================
test('nombre vacio se rechaza', () => {
  assert.equal(validarNombre(''), 'El nombre es obligatorio.');
});
test('nombre compuesto solo de espacios se rechaza', () => {
  assert.equal(validarNombre('    '), 'El nombre es obligatorio.');
});
test('nombre valido no genera error', () => {
  assert.equal(validarNombre('Ana'), undefined);
});

// ============================================================
// 5: correo con formato invalido se rechaza localmente.
// ============================================================
test('correo sin arroba se rechaza', () => {
  assert.equal(validarEmail('no-es-un-correo'), 'Ingresa un correo con un formato válido.');
});
test('correo valido no genera error', () => {
  assert.equal(validarEmail('valido@example.invalid'), undefined);
});

// ============================================================
// 6: contrasenas diferentes se rechazan localmente.
// ============================================================
test('confirmacion distinta a la contrasena se rechaza', () => {
  assert.equal(validarConfirmacionPassword('abc12345', 'xyz98765'), 'Las contraseñas no coinciden.');
});
test('confirmacion identica no genera error', () => {
  assert.equal(validarConfirmacionPassword('abc12345', 'abc12345'), undefined);
});

test('formulario de registro con datos validos pasa la validacion completa', () => {
  const resultado = validarFormularioRegistro(DATOS_VALIDOS_FICTICIOS);
  assert.equal(resultado.valido, true);
  assert.deepEqual(resultado.errores, {});
});

// ============================================================
// 7/8/9/10: una carga valida llama a signUp UNA sola vez, con la carga
// exacta esperada -- incluyendo la prueba explicita solicitada.
// ============================================================
test('carga exacta enviada a signUp (con valores ficticios)', () => {
  const carga = construirCargaSignUp(DATOS_VALIDOS_FICTICIOS, undefined);
  assert.deepEqual(carga, {
    email: 'usuario-temporal@example.invalid',
    password: 'contrasena-ficticia-123',
    options: {
      data: {
        nombre: 'Usuario Temporal',
      },
    },
  });
  // Punto 10: ningun metadato adicional se inventa -- solo "nombre",
  // que es el unico campo que handle_new_user() realmente lee.
  assert.deepEqual(Object.keys(carga.options.data), ['nombre']);
});

test('un envio valido llama a signUp exactamente una vez, con email/password/nombre correctos', async () => {
  let vecesLlamado = 0;
  let cargaRecibida = null;

  const resultado = await ejecutarRegistro(DATOS_VALIDOS_FICTICIOS, undefined, {
    signUp: async (carga) => {
      vecesLlamado += 1;
      cargaRecibida = carga;
      return { data: { user: { id: 'id-ficticio' }, session: null }, error: null };
    },
  });

  assert.equal(vecesLlamado, 1);
  assert.equal(cargaRecibida.email, DATOS_VALIDOS_FICTICIOS.email);
  assert.equal(cargaRecibida.password, DATOS_VALIDOS_FICTICIOS.password);
  assert.equal(cargaRecibida.options.data.nombre, DATOS_VALIDOS_FICTICIOS.nombre);
  assert.equal(resultado.estado, 'confirmar_correo');
});

test('datos invalidos NUNCA llegan a llamar signUp (la validacion local bloquea antes)', async () => {
  let vecesLlamado = 0;
  const datosInvalidos = { ...DATOS_VALIDOS_FICTICIOS, nombre: '   ' };

  const resultado = await ejecutarRegistro(datosInvalidos, undefined, {
    signUp: async () => {
      vecesLlamado += 1;
      return { data: { user: {}, session: null }, error: null };
    },
  });

  assert.equal(vecesLlamado, 0);
  assert.equal(resultado.estado, 'validacion_fallida');
  assert.ok(resultado.errores.nombre);
});

// ============================================================
// 13/14: registro exitoso muestra el estado correcto, y la
// confirmacion de correo se comunica SOLO cuando corresponde (segun
// data.session, nunca asumido).
// ============================================================
test('signUp con session=null -> estado confirmar_correo (Confirm email activo)', async () => {
  const resultado = await ejecutarRegistro(DATOS_VALIDOS_FICTICIOS, undefined, {
    signUp: async () => ({ data: { user: { id: 'x' }, session: null }, error: null }),
  });
  assert.equal(resultado.estado, 'confirmar_correo');
});

test('signUp con session presente -> estado sesion_iniciada (sin afirmar confirmacion de correo)', async () => {
  const resultado = await ejecutarRegistro(DATOS_VALIDOS_FICTICIOS, undefined, {
    signUp: async () => ({ data: { user: { id: 'x' }, session: { access_token: 'ficticio' } }, error: null }),
  });
  assert.equal(resultado.estado, 'sesion_iniciada');
});

test('signUp sin data.user (sin evidencia de creacion) -> error, nunca se afirma exito', async () => {
  const resultado = await ejecutarRegistro(DATOS_VALIDOS_FICTICIOS, undefined, {
    signUp: async () => ({ data: null, error: null }),
  });
  assert.equal(resultado.estado, 'error');
});

// ============================================================
// 15/16: errores de Auth sanitizados; error de red diferenciado de
// error de validacion.
// ============================================================
test('correo duplicado se clasifica y sanitiza sin exponer el mensaje crudo de Supabase', () => {
  const clasificado = clasificarErrorRegistro({
    message: 'A user with this email address has already been registered',
    status: 422,
  });
  assert.equal(clasificado.categoria, 'correo_duplicado');
  assert.equal(clasificado.mensaje, 'Ese correo ya está registrado. Intenta iniciar sesión.');
  assert.ok(!clasificado.mensaje.includes('already been registered'));
});

test('error de red (AuthRetryableFetchError) se clasifica como "red", distinto de un fallo de validacion', () => {
  const clasificado = clasificarErrorRegistro({ name: 'AuthRetryableFetchError', message: 'fetch failed', status: 0 });
  assert.equal(clasificado.categoria, 'red');
});

test('un error de red en signUp produce resultado.estado="error", no "validacion_fallida"', async () => {
  const resultado = await ejecutarRegistro(DATOS_VALIDOS_FICTICIOS, undefined, {
    signUp: async () => ({ data: null, error: { name: 'AuthRetryableFetchError', message: 'fetch failed', status: 0 } }),
  });
  assert.equal(resultado.estado, 'error');
  assert.equal(resultado.mensaje, 'No fue posible conectar con el servidor. Revisa tu conexión e intenta de nuevo.');
});

// ============================================================
// 17: las contrasenas nunca aparecen en los mensajes producidos.
// ============================================================
test('el mensaje sanitizado nunca incluye el valor de la contrasena, incluso si el error crudo la mencionara', () => {
  const secretoFicticio = 'CONTRASENA-FICTICIA-QUE-NUNCA-DEBE-APARECER';
  const clasificado = clasificarErrorRegistro({
    message: `Some internal detail leaked value=${secretoFicticio}`,
    status: 500,
  });
  assert.ok(!clasificado.mensaje.includes(secretoFicticio));
});

// ============================================================
// 18: el flujo vuelve a un estado utilizable tras un error (no hay
// estado compartido que quede "atascado" entre llamadas).
// ============================================================
test('tras un error, una llamada posterior con datos validos funciona con normalidad', async () => {
  const primero = await ejecutarRegistro(DATOS_VALIDOS_FICTICIOS, undefined, {
    signUp: async () => ({ data: null, error: { message: 'Some error', status: 500 } }),
  });
  assert.equal(primero.estado, 'error');

  const segundo = await ejecutarRegistro(DATOS_VALIDOS_FICTICIOS, undefined, {
    signUp: async () => ({ data: { user: { id: 'x' }, session: null }, error: null }),
  });
  assert.equal(segundo.estado, 'confirmar_correo');
});

// ============================================================
// Login: validacion local, carga correcta, sin cambios de contrato
// respecto de lo ya validado en los scripts de checkpoint
// (signInWithPassword({ email, password })).
// ============================================================
test('login: correo y contrasena vacios se rechazan localmente sin llamar signInWithPassword', async () => {
  let vecesLlamado = 0;
  const resultado = await ejecutarLogin(
    { email: '', password: '' },
    { signInWithPassword: async () => { vecesLlamado += 1; return { data: {}, error: null }; } }
  );
  assert.equal(vecesLlamado, 0);
  assert.equal(resultado.estado, 'validacion_fallida');
});

test('login: credenciales validas llaman signInWithPassword una vez con email y password', async () => {
  let vecesLlamado = 0;
  let credencialesRecibidas = null;
  const resultado = await ejecutarLogin(
    { email: 'usuario-temporal@example.invalid', password: 'contrasena-ficticia-123' },
    {
      signInWithPassword: async (credenciales) => {
        vecesLlamado += 1;
        credencialesRecibidas = credenciales;
        return { data: { user: { id: 'x' } }, error: null };
      },
    }
  );
  assert.equal(vecesLlamado, 1);
  assert.deepEqual(Object.keys(credencialesRecibidas).sort(), ['email', 'password']);
  assert.equal(resultado.estado, 'sesion_iniciada');
});

test('login: credenciales invalidas se sanitizan (mensaje fijo, sin detalle interno)', () => {
  const clasificado = clasificarErrorLogin({ message: 'Invalid login credentials', status: 400 });
  assert.equal(clasificado.categoria, 'credenciales_invalidas');
  assert.equal(clasificado.mensaje, 'Correo o contraseña incorrectos.');
});

// ============================================================
// 11: no existe INSERT directo en public.usuarios en ningun archivo del
// flujo de autenticacion (la creacion del perfil depende exclusivamente
// del trigger existente).
// ============================================================
test('ningun archivo del flujo de auth hace INSERT directo en public.usuarios', () => {
  const archivos = [
    'src/lib/auth/contrato.ts',
    'src/lib/supabase/client.ts',
    'src/components/auth/FormularioRegistro.tsx',
    'src/components/auth/FormularioLogin.tsx',
    'src/components/auth/ConfirmacionCorreo.tsx',
    'src/components/auth/ReenvioConfirmacion.tsx',
    'src/app/auth/callback/page.tsx',
  ];
  for (const relativo of archivos) {
    const contenido = readFileSync(path.join(RAIZ, relativo), 'utf8');
    assert.ok(!contenido.includes(".from('usuarios')"), `${relativo} no debe consultar/insertar en public.usuarios`);
    assert.ok(!contenido.includes('.insert('), `${relativo} no debe llamar .insert(...)`);
  }
});

// Verificacion separada de service_role: se busca un USO real (una clave
// de configuracion o una llamada), no la simple mencion textual -- el
// cliente documenta deliberadamente en un comentario que NUNCA se debe
// usar service_role, y esa mencion explicativa no debe contarse como
// una violacion.
test('ningun archivo del flujo de auth usa service_role como clave real', () => {
  const archivos = [
    'src/lib/auth/contrato.ts',
    'src/lib/supabase/client.ts',
    'src/components/auth/FormularioRegistro.tsx',
    'src/components/auth/FormularioLogin.tsx',
    'src/components/auth/ConfirmacionCorreo.tsx',
    'src/components/auth/ReenvioConfirmacion.tsx',
    'src/app/auth/callback/page.tsx',
  ];
  for (const relativo of archivos) {
    const contenido = readFileSync(path.join(RAIZ, relativo), 'utf8');
    assert.ok(!/SERVICE_ROLE_KEY|serviceRoleKey/i.test(contenido), `${relativo} no debe usar una clave service_role`);
  }
});

// ============================================================
// 12: el boton de registro queda protegido contra doble envio (guardia
// explicita + atributo disabled ligado al estado de envio). Verificacion
// estructural del codigo fuente real (no hay entorno DOM disponible).
// ============================================================
test('FormularioRegistro protege contra doble envio (guardia + disabled ligado a "enviando")', () => {
  const contenido = readFileSync(path.join(RAIZ, 'src/components/auth/FormularioRegistro.tsx'), 'utf8');
  assert.ok(contenido.includes('if (enviando) return;'), 'debe existir una guardia temprana contra doble envio');
  assert.ok(contenido.includes('disabled={enviando}'), 'el boton debe deshabilitarse mientras se envia');
  assert.ok(contenido.includes("estado === 'enviando'"), 'debe existir un estado explicito de envio en curso');
});

test('FormularioLogin protege contra doble envio (guardia + disabled ligado a "enviando")', () => {
  const contenido = readFileSync(path.join(RAIZ, 'src/components/auth/FormularioLogin.tsx'), 'utf8');
  assert.ok(contenido.includes('if (enviando) return;'));
  assert.ok(contenido.includes('disabled={enviando}'));
});

// ============================================================
// 19: accesibilidad minima verificable de forma estatica -- cada campo
// tiene label asociado por htmlFor/id, autocomplete correcto, y los
// errores usan role="alert" (identificables por lectores de pantalla).
// No hay widgets custom no enfocables: todo son <input>/<button> nativos.
// ============================================================
test('FormularioRegistro: cada campo tiene label asociado (htmlFor/id) y autocomplete correcto', () => {
  const contenido = readFileSync(path.join(RAIZ, 'src/components/auth/FormularioRegistro.tsx'), 'utf8');
  for (const [htmlFor, id] of [
    ['registro-nombre', 'registro-nombre'],
    ['registro-email', 'registro-email'],
    ['registro-password', 'registro-password'],
    ['registro-confirmar', 'registro-confirmar'],
  ]) {
    assert.ok(contenido.includes(`htmlFor="${htmlFor}"`), `falta htmlFor="${htmlFor}"`);
    assert.ok(contenido.includes(`id="${id}"`), `falta id="${id}"`);
  }
  assert.ok(contenido.includes('autoComplete="name"'));
  assert.ok(contenido.includes('autoComplete="email"'));
  assert.match(contenido, /autoComplete="new-password"/g);
  assert.ok(contenido.includes('role="alert"'));
});

test('FormularioLogin: campos con label asociado y autocomplete correcto', () => {
  const contenido = readFileSync(path.join(RAIZ, 'src/components/auth/FormularioLogin.tsx'), 'utf8');
  assert.ok(contenido.includes('htmlFor="login-email"'));
  assert.ok(contenido.includes('id="login-email"'));
  assert.ok(contenido.includes('autoComplete="email"'));
  assert.ok(contenido.includes('autoComplete="current-password"'));
});

// ============================================================
// 2: el usuario puede abrir el flujo de registro (existe la ruta) y
// login sigue disponible como ruta separada -- verificacion estructural
// de que ambos archivos de pagina existen.
// ============================================================
test('existen las rutas separadas /registro y /login', () => {
  assert.ok(
    readFileSync(path.join(RAIZ, 'src/app/registro/page.tsx'), 'utf8').includes('FormularioRegistro'),
    'la pagina de registro debe usar FormularioRegistro'
  );
  assert.ok(
    readFileSync(path.join(RAIZ, 'src/app/login/page.tsx'), 'utf8').includes('FormularioLogin'),
    'la pagina de login debe usar FormularioLogin'
  );
});

test('el formulario de registro enlaza a login y viceversa (flujos distinguibles, no fusionados)', () => {
  const registro = readFileSync(path.join(RAIZ, 'src/components/auth/FormularioRegistro.tsx'), 'utf8');
  const login = readFileSync(path.join(RAIZ, 'src/components/auth/FormularioLogin.tsx'), 'utf8');
  assert.ok(registro.includes('href="/login"'));
  assert.ok(login.includes('href="/registro"'));
});

// ============================================================
// Confirmacion de correo (/auth/callback). Mecanismo real confirmado:
// flowType 'implicit' (por defecto en @supabase/supabase-js 2.112.0),
// procesado por supabase.auth.initialize() + getSession() -- nunca
// exchangeCodeForSession() (PKCE) ni verifyOtp() (token_hash/OTP), que
// no corresponden al mecanismo real de este proyecto.
// ============================================================

// --- 4/5: emailRedirectTo apunta a /auth/callback, nunca a "/" ni a "/login" ---
test('emailRedirectTo del registro apunta a /auth/callback (no a "/" ni a "/login")', () => {
  const contenido = readFileSync(path.join(RAIZ, 'src/components/auth/FormularioRegistro.tsx'), 'utf8');
  assert.ok(contenido.includes('${window.location.origin}/auth/callback'), 'debe construir la URL de /auth/callback');
  assert.ok(!contenido.includes('${window.location.origin}/login'), 'ya no debe usar /login como destino de confirmacion');
});

// --- 9/10: se llama exactamente initialize()+getSession(), nunca exchangeCodeForSession/verifyOtp ---
test('una confirmacion exitosa llama initialize() y getSession() exactamente una vez cada uno', async () => {
  let vecesInitialize = 0;
  let vecesGetSession = 0;

  const resultado = await ejecutarConfirmacion({
    initialize: async () => {
      vecesInitialize += 1;
      return { error: null };
    },
    getSession: async () => {
      vecesGetSession += 1;
      return { data: { session: { access_token: 'ficticio' } } };
    },
  });

  assert.equal(vecesInitialize, 1);
  assert.equal(vecesGetSession, 1);
  assert.equal(resultado.estado, 'confirmado');
});

test('ConfirmacionCorreo.tsx no llama exchangeCodeForSession ni verifyOtp (no son el mecanismo real)', () => {
  const contenido = readFileSync(path.join(RAIZ, 'src/components/auth/ConfirmacionCorreo.tsx'), 'utf8');
  assert.ok(!contenido.includes('exchangeCodeForSession'));
  assert.ok(!contenido.includes('verifyOtp'));
  assert.ok(contenido.includes('supabase.auth.initialize'));
  assert.ok(contenido.includes('supabase.auth.getSession'));
});

// --- 11: retorno sin parametros (sin error, sin sesion) -> enlace_invalido ---
test('sin error y sin sesion -> enlace_invalido (no se asume confirmacion sin evidencia)', async () => {
  const resultado = await ejecutarConfirmacion({
    initialize: async () => ({ error: null }),
    getSession: async () => ({ data: { session: null } }),
  });
  assert.equal(resultado.estado, 'enlace_invalido');
});

test('interpretarResultadoConfirmacion: sin error y sin sesion -> enlace_invalido', () => {
  assert.deepEqual(interpretarResultadoConfirmacion({ error: null, session: null }), { estado: 'enlace_invalido' });
});

// --- 12: codigo o token invalido/generico -> error sanitizado ---
test('un error generico (sin codigo otp_expired) se clasifica como "desconocido", mensaje generico', () => {
  const clasificado = clasificarErrorConfirmacion({
    name: 'AuthImplicitGrantRedirectError',
    message: 'Some internal detail from Supabase that must never reach the user',
    details: { error: 'access_denied', code: 'unspecified_code' },
  });
  assert.equal(clasificado.categoria, 'desconocido');
  assert.equal(clasificado.mensaje, 'No fue posible confirmar el correo.');
  assert.ok(!clasificado.mensaje.includes('internal detail'));
});

// --- 13: enlace expirado/ya usado -> mensaje comprensible especifico ---
test('codigo otp_expired se clasifica como enlace_expirado, con mensaje comprensible', () => {
  const clasificado = clasificarErrorConfirmacion({
    name: 'AuthImplicitGrantRedirectError',
    message: 'Email link is invalid or has expired',
    details: { error: 'access_denied', code: 'otp_expired' },
  });
  assert.equal(clasificado.categoria, 'enlace_expirado');
  assert.equal(clasificado.mensaje, 'El enlace de confirmación venció o ya fue utilizado.');
});

test('un error de confirmacion produce resultado.estado="error" con el mensaje ya sanitizado', async () => {
  const resultado = await ejecutarConfirmacion({
    initialize: async () => ({
      error: { name: 'AuthImplicitGrantRedirectError', message: 'detalle interno', details: { code: 'otp_expired' } },
    }),
    getSession: async () => ({ data: { session: null } }),
  });
  assert.equal(resultado.estado, 'error');
  assert.equal(resultado.mensaje, 'El enlace de confirmación venció o ya fue utilizado.');
});

// --- 14: confirmacion exitosa -> estado "confirmado" ---
test('interpretarResultadoConfirmacion: sin error y con sesion -> confirmado', () => {
  assert.deepEqual(
    interpretarResultadoConfirmacion({ error: null, session: { access_token: 'ficticio' } }),
    { estado: 'confirmado' }
  );
});

// --- 17: el error interno nunca se muestra directamente ---
test('el mensaje de confirmacion nunca incluye el texto crudo interno del error', () => {
  const secretoFicticio = 'DETALLE-INTERNO-QUE-NUNCA-DEBE-VERSE-EN-PANTALLA';
  const clasificado = clasificarErrorConfirmacion({
    name: 'AuthImplicitGrantRedirectError',
    message: secretoFicticio,
    details: { code: 'algo_no_reconocido' },
  });
  assert.ok(!clasificado.mensaje.includes(secretoFicticio));
});

// --- 6/23: la ruta callback muestra un estado de carga perceptible ---
test('ConfirmacionCorreo.tsx muestra un estado de carga perceptible ("Confirmando tu correo…")', () => {
  const contenido = readFileSync(path.join(RAIZ, 'src/components/auth/ConfirmacionCorreo.tsx'), 'utf8');
  assert.ok(contenido.includes("estado === 'cargando'"));
  assert.ok(contenido.includes('Confirmando tu correo'));
  assert.ok(contenido.includes('role="status"'));
});

// --- 8: proteccion contra doble procesamiento en Strict Mode ---
test('ConfirmacionCorreo.tsx protege contra doble procesamiento (guardia useRef + limpieza del efecto)', () => {
  const contenido = readFileSync(path.join(RAIZ, 'src/components/auth/ConfirmacionCorreo.tsx'), 'utf8');
  assert.ok(contenido.includes('yaIniciado.current'), 'debe existir una guardia contra doble ejecucion del efecto');
  assert.ok(contenido.includes('cancelado = true'), 'debe existir limpieza que ignore resultados tardios');
});

// --- 15/24: navegacion a /login disponible en todos los estados finales, pagina utilizable tras error ---
test('ConfirmacionCorreo.tsx ofrece navegacion a /login en los tres estados finales (confirmado, enlace_invalido, error)', () => {
  const contenido = readFileSync(path.join(RAIZ, 'src/components/auth/ConfirmacionCorreo.tsx'), 'utf8');
  const coincidencias = contenido.match(/href="\/login"/g) ?? [];
  assert.equal(coincidencias.length, 3, 'debe haber un enlace a /login en confirmado, enlace_invalido y error');
});

// --- 16/18/19: sin logs sensibles, sin INSERT directo, sin signUp automatico en el callback ---
test('ConfirmacionCorreo.tsx no imprime nada, no inserta en public.usuarios y no llama signUp', () => {
  const contenido = readFileSync(path.join(RAIZ, 'src/components/auth/ConfirmacionCorreo.tsx'), 'utf8');
  assert.ok(!/console\.(log|error|warn)/.test(contenido), 'no debe haber console.log/error/warn');
  assert.ok(!contenido.includes(".from('usuarios')"));
  assert.ok(!contenido.includes('.insert('));
  assert.ok(!contenido.includes('signUp'));
});

test('src/app/auth/callback/page.tsx existe y usa ConfirmacionCorreo', () => {
  const contenido = readFileSync(path.join(RAIZ, 'src/app/auth/callback/page.tsx'), 'utf8');
  assert.ok(contenido.includes('ConfirmacionCorreo'));
});

// --- 22: accesibilidad -- navegacion nativa (Link), sin widgets custom no enfocables ---
test('ConfirmacionCorreo.tsx usa navegacion nativa (Link) en vez de manejadores de click personalizados', () => {
  const contenido = readFileSync(path.join(RAIZ, 'src/components/auth/ConfirmacionCorreo.tsx'), 'utf8');
  assert.ok(contenido.includes("from 'next/link'"));
  assert.ok(!contenido.includes('onClick'));
});

// ============================================================
// Reenvio de correo de confirmacion (supabase.auth.resend, type: "signup",
// sin contrasena). Contrato confirmado leyendo node_modules/@supabase/auth-js
// (GoTrueClient.d.ts, lib/types.ts) version 2.112.0.
// ============================================================

test('construirCargaResend produce exactamente type "signup", el email dado y emailRedirectTo, sin contrasena', () => {
  const carga = construirCargaResend('usuario-temporal@example.invalid', 'https://app.example.invalid/auth/callback');
  assert.deepEqual(carga, {
    type: 'signup',
    email: 'usuario-temporal@example.invalid',
    options: { emailRedirectTo: 'https://app.example.invalid/auth/callback' },
  });
  assert.ok(!('password' in carga), 'la carga de reenvio no debe incluir contrasena');
});

test('construirCargaResend recorta espacios del correo', () => {
  const carga = construirCargaResend('  usuario-temporal@example.invalid  ', 'https://app.example.invalid/auth/callback');
  assert.equal(carga.email, 'usuario-temporal@example.invalid');
});

test('ejecutarReenvio: un correo con formato invalido se rechaza localmente sin llamar a resend', async () => {
  let vecesLlamado = 0;
  const resultado = await ejecutarReenvio('no-es-un-correo', 'https://app.example.invalid/auth/callback', {
    resend: async () => {
      vecesLlamado += 1;
      return { data: {}, error: null };
    },
  });
  assert.equal(vecesLlamado, 0);
  assert.equal(resultado.estado, 'email_invalido');
});

test('ejecutarReenvio: una solicitud valida llama a resend exactamente una vez, con type "signup" y el correo dado', async () => {
  let vecesLlamado = 0;
  let cargaRecibida = null;

  const resultado = await ejecutarReenvio('usuario-temporal@example.invalid', 'https://app.example.invalid/auth/callback', {
    resend: async (carga) => {
      vecesLlamado += 1;
      cargaRecibida = carga;
      return { data: {}, error: null };
    },
  });

  assert.equal(vecesLlamado, 1);
  assert.equal(cargaRecibida.type, 'signup');
  assert.equal(cargaRecibida.email, 'usuario-temporal@example.invalid');
  assert.equal(resultado.estado, 'solicitud_procesada');
});

test('ejecutarReenvio: emailRedirectTo termina exactamente en /auth/callback (nunca en "/")', async () => {
  let cargaRecibida = null;
  await ejecutarReenvio('usuario-temporal@example.invalid', 'https://app.example.invalid/auth/callback', {
    resend: async (carga) => {
      cargaRecibida = carga;
      return { data: {}, error: null };
    },
  });
  assert.ok(cargaRecibida.options.emailRedirectTo.endsWith('/auth/callback'));
  assert.notEqual(cargaRecibida.options.emailRedirectTo, 'https://app.example.invalid/');
});

test('ejecutarReenvio: exito produce resultado neutral "solicitud_procesada"', async () => {
  const resultado = await ejecutarReenvio('usuario-temporal@example.invalid', 'https://app.example.invalid/auth/callback', {
    resend: async () => ({ data: {}, error: null }),
  });
  assert.equal(resultado.estado, 'solicitud_procesada');
});

test('ejecutarReenvio: un error desconocido (ej. correo inexistente o ya confirmado) produce el MISMO resultado neutral, sin revelar existencia de la cuenta', async () => {
  const resultado = await ejecutarReenvio('usuario-temporal@example.invalid', 'https://app.example.invalid/auth/callback', {
    resend: async () => ({ data: null, error: { message: 'User not found', status: 400 } }),
  });
  assert.equal(resultado.estado, 'solicitud_procesada');
});

test('ejecutarReenvio: limite de frecuencia (over_email_send_rate_limit) produce un resultado distinguible y comprensible', async () => {
  const resultado = await ejecutarReenvio('usuario-temporal@example.invalid', 'https://app.example.invalid/auth/callback', {
    resend: async () => ({ data: null, error: { code: 'over_email_send_rate_limit', message: 'email rate limit exceeded', status: 429 } }),
  });
  assert.equal(resultado.estado, 'limite_frecuencia');
  assert.ok(resultado.mensaje.length > 0);
});

test('ejecutarReenvio: un error de red produce un resultado sanitizado distinto del neutral', async () => {
  const resultado = await ejecutarReenvio('usuario-temporal@example.invalid', 'https://app.example.invalid/auth/callback', {
    resend: async () => ({ data: null, error: { name: 'AuthRetryableFetchError', message: 'fetch failed', status: 0 } }),
  });
  assert.equal(resultado.estado, 'error_red');
});

test('clasificarErrorReenvio: nunca expone el mensaje interno crudo de Supabase', () => {
  const secretoFicticio = 'DETALLE-INTERNO-QUE-NUNCA-DEBE-VERSE-EN-PANTALLA';
  const clasificado = clasificarErrorReenvio({ message: secretoFicticio, status: 500 });
  assert.ok(!clasificado.mensaje.includes(secretoFicticio));
});

test('un fallo inesperado (excepcion) en resend tambien produce un resultado utilizable, no una excepcion sin controlar', async () => {
  const resultado = await ejecutarReenvio('usuario-temporal@example.invalid', 'https://app.example.invalid/auth/callback', {
    resend: async () => {
      throw { name: 'AuthRetryableFetchError', message: 'fetch failed', status: 0 };
    },
  });
  assert.equal(resultado.estado, 'error_red');
});

// ============================================================
// ReenvioConfirmacion.tsx: verificacion estructural del componente de UI
// (sin entorno DOM disponible, igual que el resto de la suite).
// ============================================================

test('ReenvioConfirmacion.tsx no requiere contrasena y no llama signUp ni metodos administrativos', () => {
  const contenido = readFileSync(path.join(RAIZ, 'src/components/auth/ReenvioConfirmacion.tsx'), 'utf8');
  assert.ok(!/type=["']password["']/.test(contenido), 'no debe existir un campo de contrasena');
  assert.ok(!contenido.includes('signUp'), 'no debe llamar signUp como sustituto del reenvio');
  assert.ok(!contenido.includes('.admin.'), 'no debe usar la API administrativa de Supabase');
});

test('ReenvioConfirmacion.tsx llama a supabase.auth.resend con type "signup" via ejecutarReenvio', () => {
  const contenido = readFileSync(path.join(RAIZ, 'src/components/auth/ReenvioConfirmacion.tsx'), 'utf8');
  assert.ok(contenido.includes('supabase.auth.resend'));
  assert.ok(contenido.includes('ejecutarReenvio'));
});

test('ReenvioConfirmacion.tsx construye emailRedirectTo con el origen actual y la ruta fija /auth/callback', () => {
  const contenido = readFileSync(path.join(RAIZ, 'src/components/auth/ReenvioConfirmacion.tsx'), 'utf8');
  assert.ok(contenido.includes('${window.location.origin}/auth/callback'));
});

test('ReenvioConfirmacion.tsx no acepta un destino de redireccion controlado por parametros externos', () => {
  const contenido = readFileSync(path.join(RAIZ, 'src/components/auth/ReenvioConfirmacion.tsx'), 'utf8');
  assert.ok(!contenido.includes('useSearchParams'));
  assert.ok(!contenido.includes('location.search'));
  assert.ok(!contenido.includes('URLSearchParams'));
});

test('ReenvioConfirmacion.tsx protege contra doble envio (guardia + disabled ligado a "enviando")', () => {
  const contenido = readFileSync(path.join(RAIZ, 'src/components/auth/ReenvioConfirmacion.tsx'), 'utf8');
  assert.ok(contenido.includes('if (enviando) return;'));
  assert.ok(contenido.includes('disabled={enviando}'));
  assert.ok(contenido.includes("estado === 'enviando'"));
});

test('ReenvioConfirmacion.tsx no imprime correos, tokens ni la respuesta del SDK en consola', () => {
  const contenido = readFileSync(path.join(RAIZ, 'src/components/auth/ReenvioConfirmacion.tsx'), 'utf8');
  assert.ok(!/console\.(log|error|warn|info|debug)/.test(contenido));
});

test('ReenvioConfirmacion.tsx: el campo de correo tiene label asociado (htmlFor/id) y autocomplete correcto', () => {
  const contenido = readFileSync(path.join(RAIZ, 'src/components/auth/ReenvioConfirmacion.tsx'), 'utf8');
  assert.ok(contenido.includes('htmlFor="reenvio-email"'));
  assert.ok(contenido.includes('id="reenvio-email"'));
  assert.ok(contenido.includes('autoComplete="email"'));
});

test('ReenvioConfirmacion.tsx marca el mensaje neutral y los mensajes de error con atributos accesibles (role)', () => {
  const contenido = readFileSync(path.join(RAIZ, 'src/components/auth/ReenvioConfirmacion.tsx'), 'utf8');
  assert.ok(contenido.includes('role="status"'));
  assert.ok(contenido.includes('role="alert"'));
});

test('ReenvioConfirmacion.tsx es accesible por teclado (boton nativo, sin manejadores de solo mouse)', () => {
  const contenido = readFileSync(path.join(RAIZ, 'src/components/auth/ReenvioConfirmacion.tsx'), 'utf8');
  assert.ok(contenido.includes('<button'), 'el disparador debe ser un <button> nativo (enfocable y activable con teclado)');
});

// ============================================================
// FormularioLogin.tsx sigue disponible con su contrato intacto, y ahora
// integra el reenvio como opcion discreta (sin alterar el <form> de login).
// ============================================================

test('FormularioLogin.tsx integra ReenvioConfirmacion sin alterar su propio formulario de login', () => {
  const contenido = readFileSync(path.join(RAIZ, 'src/components/auth/FormularioLogin.tsx'), 'utf8');
  assert.ok(contenido.includes("import ReenvioConfirmacion from './ReenvioConfirmacion'"));
  assert.ok(contenido.includes('<ReenvioConfirmacion'));
  // El contrato de login (email/password, ejecutarLogin, guardia de doble envio)
  // sigue intacto -- ya cubierto por las pruebas previas de este archivo.
  assert.ok(contenido.includes('ejecutarLogin'));
  assert.ok(contenido.includes('if (enviando) return;'));
});

test('/login y /registro siguen disponibles como rutas separadas tras agregar el reenvio', () => {
  assert.ok(
    readFileSync(path.join(RAIZ, 'src/app/login/page.tsx'), 'utf8').includes('FormularioLogin'),
    'la pagina de login debe seguir usando FormularioLogin'
  );
  assert.ok(
    readFileSync(path.join(RAIZ, 'src/app/registro/page.tsx'), 'utf8').includes('FormularioRegistro'),
    'la pagina de registro debe seguir usando FormularioRegistro'
  );
});
