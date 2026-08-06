// Contrato de registro/inicio de sesion, derivado directamente de
// supabase/migrations/0001_dia2_esquema_base.sql (public.usuarios y el
// trigger handle_new_user()). No es codigo generado "por si acaso":
// cada regla de aqui corresponde a una restriccion real del backend.
//
// Contrato confirmado en el SQL:
//   - public.usuarios.nombre: not null, check (char_length(trim(nombre)) > 0).
//   - handle_new_user() exige new.email no nulo (lo entrega Supabase Auth,
//     no el frontend) y raw_user_meta_data->>'nombre' no vacio tras trim();
//     si falta, aborta con excepcion y NINGUN usuario se crea (ni siquiera
//     en auth.users), tal como se observo en el Dashboard.
//   - Ningun otro campo de raw_user_meta_data es leido por el trigger.
//   - public.usuarios.email es unique, pero se copia automaticamente
//     desde auth.users.email -- Supabase Auth ya impide correos
//     duplicados en signUp() antes de que el trigger se ejecute.
//   - id y fecha_registro se generan automaticamente; no los provee el
//     cliente.
//
// La longitud minima de la contrasena (6) es el valor por defecto
// documentado de Supabase Auth, NO una regla confirmada contra la
// configuracion real de este proyecto (eso requeriria el dashboard,
// fuera de alcance de este cambio). El servidor sigue siendo la fuente
// de verdad: un rechazo real del backend se sanitiza igualmente.
const LONGITUD_MINIMA_PASSWORD = 6;

// Limite de UX, no proviene del esquema: public.usuarios.nombre es
// "text" sin restriccion de longitud maxima.
const LONGITUD_MAXIMA_NOMBRE = 100;

const PATRON_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface DatosRegistro {
  nombre: string;
  email: string;
  password: string;
  confirmarPassword: string;
}

export interface DatosLogin {
  email: string;
  password: string;
}

export interface ErroresRegistro {
  nombre?: string;
  email?: string;
  password?: string;
  confirmarPassword?: string;
}

export interface ErroresLogin {
  email?: string;
  password?: string;
}

export interface ResultadoValidacion<E> {
  valido: boolean;
  errores: E;
}

export function validarNombre(nombre: string): string | undefined {
  const limpio = nombre.trim();
  if (limpio.length === 0) return 'El nombre es obligatorio.';
  if (limpio.length > LONGITUD_MAXIMA_NOMBRE) {
    return `El nombre no puede superar los ${LONGITUD_MAXIMA_NOMBRE} caracteres.`;
  }
  return undefined;
}

export function validarEmail(email: string): string | undefined {
  const limpio = email.trim();
  if (limpio.length === 0) return 'El correo es obligatorio.';
  if (!PATRON_EMAIL.test(limpio)) return 'Ingresa un correo con un formato válido.';
  return undefined;
}

export function validarPassword(password: string): string | undefined {
  if (password.length === 0) return 'La contraseña es obligatoria.';
  if (password.length < LONGITUD_MINIMA_PASSWORD) {
    return `La contraseña debe tener al menos ${LONGITUD_MINIMA_PASSWORD} caracteres.`;
  }
  return undefined;
}

export function validarConfirmacionPassword(password: string, confirmacion: string): string | undefined {
  if (confirmacion.length === 0) return 'Confirma tu contraseña.';
  if (confirmacion !== password) return 'Las contraseñas no coinciden.';
  return undefined;
}

export function validarFormularioRegistro(datos: DatosRegistro): ResultadoValidacion<ErroresRegistro> {
  const errores: ErroresRegistro = {};
  const errorNombre = validarNombre(datos.nombre);
  if (errorNombre) errores.nombre = errorNombre;
  const errorEmail = validarEmail(datos.email);
  if (errorEmail) errores.email = errorEmail;
  const errorPassword = validarPassword(datos.password);
  if (errorPassword) errores.password = errorPassword;
  const errorConfirmacion = validarConfirmacionPassword(datos.password, datos.confirmarPassword);
  if (errorConfirmacion) errores.confirmarPassword = errorConfirmacion;
  return { valido: Object.keys(errores).length === 0, errores };
}

export function validarFormularioLogin(datos: DatosLogin): ResultadoValidacion<ErroresLogin> {
  const errores: ErroresLogin = {};
  const errorEmail = validarEmail(datos.email);
  if (errorEmail) errores.email = errorEmail;
  if (datos.password.length === 0) errores.password = 'La contraseña es obligatoria.';
  return { valido: Object.keys(errores).length === 0, errores };
}

// ----------------------------------------------------------------
// Carga exacta enviada a supabase.auth.signUp(). "nombre" viaja dentro
// de options.data porque asi lo exige el trigger handle_new_user(), que
// lee raw_user_meta_data ->> 'nombre' (clave en minusculas, sin acentos).
// emailRedirectTo es opcional: si se provee, apunta a la URL de ESTA
// aplicacion a la que Supabase debe redirigir tras confirmar el correo
// (evita la URL de redireccion no operativa detectada en el Checkpoint 2,
// sin tocar la configuracion del proyecto en el dashboard).
// ----------------------------------------------------------------
export interface CargaSignUp {
  email: string;
  password: string;
  options: {
    data: {
      nombre: string;
    };
    emailRedirectTo?: string;
  };
}

export function construirCargaSignUp(datos: DatosRegistro, emailRedirectTo?: string): CargaSignUp {
  const opciones: CargaSignUp['options'] = {
    data: {
      nombre: datos.nombre.trim(),
    },
  };
  if (emailRedirectTo) opciones.emailRedirectTo = emailRedirectTo;

  return {
    email: datos.email.trim(),
    password: datos.password,
    options: opciones,
  };
}

// ----------------------------------------------------------------
// Clasificacion sanitizada de errores de Auth. Nunca se propaga el
// mensaje crudo de Supabase/Postgres al usuario: se usa solo para
// decidir la categoria, y el mensaje mostrado es siempre uno fijo,
// redactado aqui.
// ----------------------------------------------------------------
export type CategoriaErrorAuth =
  | 'correo_duplicado'
  | 'password_invalida'
  | 'metadatos_rechazados'
  | 'credenciales_invalidas'
  | 'red'
  | 'desconocido';

export interface ErrorAuthClasificado {
  categoria: CategoriaErrorAuth;
  mensaje: string;
}

interface FormaErrorAuth {
  message?: string;
  status?: number;
  code?: string;
  name?: string;
}

function comoFormaErrorAuth(error: unknown): FormaErrorAuth {
  if (error && typeof error === 'object') return error as FormaErrorAuth;
  return {};
}

// Mismo patron de deteccion de fallo de red/transporte usado y validado
// en scripts/checkpoint*.mjs (AuthRetryableFetchError, status 0).
function esErrorDeRed(e: FormaErrorAuth): boolean {
  const mensaje = (e.message ?? '').toLowerCase();
  return e.name === 'AuthRetryableFetchError' || mensaje.includes('fetch failed') || e.status === 0;
}

export function clasificarErrorRegistro(error: unknown): ErrorAuthClasificado {
  const e = comoFormaErrorAuth(error);
  const mensaje = (e.message ?? '').toLowerCase();

  if (esErrorDeRed(e)) {
    return { categoria: 'red', mensaje: 'No fue posible conectar con el servidor. Revisa tu conexión e intenta de nuevo.' };
  }
  const pareceCorreoDuplicado =
    (mensaje.includes('already') && mensaje.includes('regist')) ||
    mensaje.includes('already exists') ||
    e.code === 'user_already_exists';
  if (pareceCorreoDuplicado) {
    return { categoria: 'correo_duplicado', mensaje: 'Ese correo ya está registrado. Intenta iniciar sesión.' };
  }
  if (mensaje.includes('password') && (mensaje.includes('weak') || mensaje.includes('short') || mensaje.includes('least') || mensaje.includes('character'))) {
    return { categoria: 'password_invalida', mensaje: 'La contraseña no cumple los requisitos mínimos.' };
  }
  if (mensaje.includes('nombre') || mensaje.includes('metadata') || mensaje.includes('metadatos')) {
    return { categoria: 'metadatos_rechazados', mensaje: 'No fue posible completar el registro con los datos proporcionados.' };
  }
  return { categoria: 'desconocido', mensaje: 'No fue posible crear la cuenta. Intenta de nuevo.' };
}

export function clasificarErrorLogin(error: unknown): ErrorAuthClasificado {
  const e = comoFormaErrorAuth(error);
  const mensaje = (e.message ?? '').toLowerCase();

  if (esErrorDeRed(e)) {
    return { categoria: 'red', mensaje: 'No fue posible conectar con el servidor. Revisa tu conexión e intenta de nuevo.' };
  }
  if (mensaje.includes('email not confirmed')) {
    return { categoria: 'credenciales_invalidas', mensaje: 'Confirma tu correo antes de iniciar sesión.' };
  }
  if (mensaje.includes('invalid login credentials') || mensaje.includes('invalid credentials')) {
    return { categoria: 'credenciales_invalidas', mensaje: 'Correo o contraseña incorrectos.' };
  }
  return { categoria: 'desconocido', mensaje: 'No fue posible iniciar sesión. Intenta de nuevo.' };
}

// ----------------------------------------------------------------
// Orquestacion (sin React, sin DOM): separa la decision de "que hacer"
// de "como mostrarlo". Recibe signUp/signInWithPassword como
// dependencias inyectadas -- esto es lo que permite probar el flujo
// completo (incluida la carga exacta enviada) con un doble local, sin
// necesitar un entorno de navegador ni contactar Supabase.
// ----------------------------------------------------------------

interface RespuestaSignUp {
  data: { user: unknown; session: unknown } | null;
  error: unknown;
}

export interface DependenciasRegistro {
  signUp: (carga: CargaSignUp) => Promise<RespuestaSignUp>;
}

export type ResultadoRegistro =
  | { estado: 'validacion_fallida'; errores: ErroresRegistro }
  | { estado: 'confirmar_correo' }
  | { estado: 'sesion_iniciada' }
  | { estado: 'error'; mensaje: string };

export async function ejecutarRegistro(
  datos: DatosRegistro,
  emailRedirectTo: string | undefined,
  dependencias: DependenciasRegistro
): Promise<ResultadoRegistro> {
  const validacion = validarFormularioRegistro(datos);
  if (!validacion.valido) {
    return { estado: 'validacion_fallida', errores: validacion.errores };
  }

  const carga = construirCargaSignUp(datos, emailRedirectTo);

  try {
    const { data, error } = await dependencias.signUp(carga);

    if (error) {
      return { estado: 'error', mensaje: clasificarErrorRegistro(error).mensaje };
    }
    // Sin evidencia de que el usuario se haya creado, no se afirma nada:
    // se trata como error sanitizado, no como exito silencioso.
    if (!data?.user) {
      return { estado: 'error', mensaje: 'No fue posible confirmar la creación de la cuenta. Intenta de nuevo.' };
    }
    // data.session no nulo == Supabase entrego sesion inmediata (Confirm
    // email desactivado); null == requiere confirmar el correo primero.
    // Se decide en tiempo real segun la respuesta real, nunca se asume.
    return { estado: data.session ? 'sesion_iniciada' : 'confirmar_correo' };
  } catch (error) {
    return { estado: 'error', mensaje: clasificarErrorRegistro(error).mensaje };
  }
}

interface RespuestaSignIn {
  data: unknown;
  error: unknown;
}

export interface DependenciasLogin {
  signInWithPassword: (credenciales: { email: string; password: string }) => Promise<RespuestaSignIn>;
}

export type ResultadoLogin =
  | { estado: 'validacion_fallida'; errores: ErroresLogin }
  | { estado: 'sesion_iniciada' }
  | { estado: 'error'; mensaje: string };

export async function ejecutarLogin(
  datos: DatosLogin,
  dependencias: DependenciasLogin
): Promise<ResultadoLogin> {
  const validacion = validarFormularioLogin(datos);
  if (!validacion.valido) {
    return { estado: 'validacion_fallida', errores: validacion.errores };
  }

  try {
    const { error } = await dependencias.signInWithPassword({
      email: datos.email.trim(),
      password: datos.password,
    });

    if (error) {
      return { estado: 'error', mensaje: clasificarErrorLogin(error).mensaje };
    }
    return { estado: 'sesion_iniciada' };
  } catch (error) {
    return { estado: 'error', mensaje: clasificarErrorLogin(error).mensaje };
  }
}

// ----------------------------------------------------------------
// Confirmacion de correo (ruta /auth/callback).
//
// Mecanismo real confirmado leyendo node_modules/@supabase/auth-js
// (GoTrueClient.ts), no asumido:
//   - Este proyecto NO fija "flowType" al crear el cliente, por lo que
//     usa el valor por defecto real de la version instalada (2.112.0):
//     flowType: 'implicit' (DEFAULT_AUTH_OPTIONS, linea ~204). NO es
//     PKCE: signUp() nunca genera un code_verifier/code_challenge, asi
//     que el enlace de confirmacion jamas traera un parametro "code" que
//     intercambiar.
//   - detectSessionInUrl (tambien por defecto: true) hace que la propia
//     construccion del cliente en el navegador dispare _initialize(),
//     que ya parsea window.location.href buscando un "callback implicito"
//     (hash con access_token, o con error/error_description/error_code)
//     y, si lo encuentra, establece la sesion automaticamente -- sin que
//     el codigo de la aplicacion necesite llamar exchangeCodeForSession()
//     ni verifyOtp() (esos son para PKCE y para el flujo token_hash/OTP
//     respectivamente; ninguno de los dos es el mecanismo real aqui, asi
//     que deliberadamente NO se usan).
//   - El metodo publico initialize() expone exactamente ese resultado
//     ({ error }) y es idempotente: si ya se llamo (incluida la llamada
//     automatica del constructor), una segunda llamada devuelve la MISMA
//     promesa ya resuelta en vez de reprocesar la URL -- esto es lo que
//     hace seguro invocarlo desde un efecto de React bajo Strict Mode
//     (doble invocacion) sin un intercambio doble.
//   - Tras initialize(), getSession() confirma si quedo una sesion real
//     establecida.
// ----------------------------------------------------------------
export type CategoriaErrorConfirmacion = 'enlace_expirado' | 'red' | 'desconocido';

export interface ErrorConfirmacionClasificado {
  categoria: CategoriaErrorConfirmacion;
  mensaje: string;
}

interface FormaErrorConfirmacion extends FormaErrorAuth {
  details?: { code?: string; error?: string };
}

export function clasificarErrorConfirmacion(error: unknown): ErrorConfirmacionClasificado {
  const e = comoFormaErrorAuth(error) as FormaErrorConfirmacion;

  if (esErrorDeRed(e)) {
    return { categoria: 'red', mensaje: 'No fue posible conectar con el servidor. Revisa tu conexión e intenta de nuevo.' };
  }

  // Codigo interno que Supabase adjunta a AuthImplicitGrantRedirectError
  // cuando el enlace vencio o ya fue usado (ver GoTrueClient.ts,
  // _getSessionFromURL: throw new AuthImplicitGrantRedirectError(..., { code: params.error_code })).
  const codigoInterno = e.details?.code ?? '';
  if (codigoInterno === 'otp_expired' || codigoInterno === 'expired_token') {
    return { categoria: 'enlace_expirado', mensaje: 'El enlace de confirmación venció o ya fue utilizado.' };
  }

  return { categoria: 'desconocido', mensaje: 'No fue posible confirmar el correo.' };
}

export type ResultadoConfirmacion =
  | { estado: 'confirmado' }
  | { estado: 'enlace_invalido' }
  | { estado: 'error'; mensaje: string };

export function interpretarResultadoConfirmacion(args: { error: unknown; session: unknown }): ResultadoConfirmacion {
  if (args.error) {
    return { estado: 'error', mensaje: clasificarErrorConfirmacion(args.error).mensaje };
  }
  // Sin error Y sin sesion == no habia parametros de confirmacion validos
  // en la URL (enlace reutilizado tras limpiarse el hash, navegacion
  // directa a la ruta, etc.) -- no se asume que "sin error" equivale a
  // "confirmado": se exige evidencia positiva (sesion presente).
  if (args.session) {
    return { estado: 'confirmado' };
  }
  return { estado: 'enlace_invalido' };
}

export interface DependenciasConfirmacion {
  initialize: () => Promise<{ error: unknown }>;
  getSession: () => Promise<{ data: { session: unknown } }>;
}

export async function ejecutarConfirmacion(dependencias: DependenciasConfirmacion): Promise<ResultadoConfirmacion> {
  try {
    const { error } = await dependencias.initialize();
    if (error) {
      return interpretarResultadoConfirmacion({ error, session: null });
    }
    const { data } = await dependencias.getSession();
    return interpretarResultadoConfirmacion({ error: null, session: data.session });
  } catch (error) {
    return interpretarResultadoConfirmacion({ error, session: null });
  }
}

// ----------------------------------------------------------------
// Reenvio de correo de confirmacion (cuenta pendiente, sin contrasena).
//
// Contrato confirmado leyendo node_modules/@supabase/auth-js (version
// 2.112.0, la misma que @supabase/supabase-js instalado):
//   - GoTrueClient.resend(credentials: ResendParams): Promise<AuthOtpResponse>
//   - Para type: 'signup', ResendParams exige { type, email,
//     options?: { emailRedirectTo?, captchaToken? } } -- ninguna
//     contrasena, ningun metodo administrativo.
//   - error-codes.ts define codigos reales de limite de frecuencia:
//     'over_email_send_rate_limit' y 'over_request_rate_limit'.
// ----------------------------------------------------------------
export interface CargaResend {
  type: 'signup';
  email: string;
  options: {
    emailRedirectTo: string;
  };
}

export function construirCargaResend(email: string, emailRedirectTo: string): CargaResend {
  return {
    type: 'signup',
    email: email.trim(),
    options: { emailRedirectTo },
  };
}

export type CategoriaErrorReenvio = 'limite_frecuencia' | 'red' | 'desconocido';

export interface ErrorReenvioClasificado {
  categoria: CategoriaErrorReenvio;
  mensaje: string;
}

function esLimiteFrecuencia(e: FormaErrorAuth): boolean {
  const mensaje = (e.message ?? '').toLowerCase();
  return (
    e.code === 'over_email_send_rate_limit' ||
    e.code === 'over_request_rate_limit' ||
    e.status === 429 ||
    mensaje.includes('rate limit')
  );
}

export function clasificarErrorReenvio(error: unknown): ErrorReenvioClasificado {
  const e = comoFormaErrorAuth(error);

  if (esErrorDeRed(e)) {
    return { categoria: 'red', mensaje: 'No fue posible conectar con el servidor. Revisa tu conexión e intenta de nuevo.' };
  }
  if (esLimiteFrecuencia(e)) {
    return {
      categoria: 'limite_frecuencia',
      mensaje: 'Ya solicitaste un correo hace poco. Espera unos minutos antes de volver a intentarlo.',
    };
  }
  // Cualquier otro error (correo inexistente, cuenta ya confirmada, etc.)
  // se clasifica como "desconocido" y NUNCA se distingue en la interfaz:
  // ejecutarReenvio() lo convierte en el mismo resultado neutral que un
  // envio exitoso, para no permitir enumeracion de cuentas.
  return { categoria: 'desconocido', mensaje: 'No fue posible procesar la solicitud. Intenta de nuevo más tarde.' };
}

export type ResultadoReenvio =
  | { estado: 'email_invalido'; error: string }
  | { estado: 'solicitud_procesada' }
  | { estado: 'limite_frecuencia'; mensaje: string }
  | { estado: 'error_red'; mensaje: string };

interface RespuestaResend {
  data: unknown;
  error: unknown;
}

export interface DependenciasReenvio {
  resend: (carga: CargaResend) => Promise<RespuestaResend>;
}

export async function ejecutarReenvio(
  email: string,
  emailRedirectTo: string,
  dependencias: DependenciasReenvio
): Promise<ResultadoReenvio> {
  const errorEmail = validarEmail(email);
  if (errorEmail) {
    return { estado: 'email_invalido', error: errorEmail };
  }

  const carga = construirCargaResend(email, emailRedirectTo);

  try {
    const { error } = await dependencias.resend(carga);
    if (!error) return { estado: 'solicitud_procesada' };

    const clasificado = clasificarErrorReenvio(error);
    if (clasificado.categoria === 'red') return { estado: 'error_red', mensaje: clasificado.mensaje };
    if (clasificado.categoria === 'limite_frecuencia') {
      return { estado: 'limite_frecuencia', mensaje: clasificado.mensaje };
    }
    return { estado: 'solicitud_procesada' };
  } catch (error) {
    const clasificado = clasificarErrorReenvio(error);
    if (clasificado.categoria === 'red') return { estado: 'error_red', mensaje: clasificado.mensaje };
    if (clasificado.categoria === 'limite_frecuencia') {
      return { estado: 'limite_frecuencia', mensaje: clasificado.mensaje };
    }
    return { estado: 'solicitud_procesada' };
  }
}
