// Cliente de Supabase para codigo de SERVIDOR (rutas de API).
//
// Archivo separado de client.ts a proposito (RULES.md seccion 2): aquel
// es un singleton del navegador con sesion persistida; este crea un
// cliente NUEVO por peticion, sin persistir nada, atado al token del
// usuario que hizo esa peticion concreta. Mezclarlos provocaria que dos
// peticiones simultaneas compartieran identidad.
//
// Clave usada: SIEMPRE la publicable (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
// la misma del navegador. NO se introduce service_role: la autorizacion
// real la siguen imponiendo las policies RLS existentes, evaluadas con la
// identidad del token. Es decir, el servidor no puede hacer nada que el
// propio usuario no pudiera hacer.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

if (typeof window !== 'undefined') {
  throw new Error('El cliente de servidor de Supabase no puede usarse en el navegador.');
}

function leerConfiguracion(): { url: string; clave: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clave = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !clave) {
    throw new Error('Faltan las variables de entorno de Supabase en el servidor.');
  }
  return { url, clave };
}

// Cliente ligado al token del usuario. Al enviar el Authorization en las
// cabeceras globales, PostgREST evalua las policies RLS con ese usuario,
// de modo que auth.uid() dentro de las funciones SECURITY DEFINER
// devuelve su identidad real.
export function crearClienteConToken(token: string): SupabaseClient {
  const { url, clave } = leerConfiguracion();
  return createClient(url, clave, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

// Extrae el token de una cabecera Authorization con formato Bearer.
// Devuelve null ante cualquier forma inesperada -- nunca lanza, para que
// la ruta pueda responder 401 de forma uniforme.
export function extraerTokenBearer(cabecera: string | null): string | null {
  if (!cabecera) return null;
  const partes = cabecera.trim().split(/\s+/);
  if (partes.length !== 2) return null;
  if (partes[0].toLowerCase() !== 'bearer') return null;
  const token = partes[1].trim();
  return token.length > 0 ? token : null;
}

// Decision sobre el resultado de la RPC de persistencia. Se extrae de la
// ruta de API para poder probarse con dobles locales, sin levantar un
// servidor HTTP ni contactar Supabase.
//
// Regla central: NO se declara exito sin evidencia positiva de la fila
// creada. Un error nulo con cero filas se trata como fallo, no como
// exito silencioso -- mismo criterio que ejecutarRegistro en el contrato
// de autenticacion.
export type ResultadoPersistencia = 'persistido' | 'diagnostico_existente' | 'no_persistido';

export function interpretarResultadoPersistencia(respuesta: {
  data: unknown;
  error: unknown;
}): ResultadoPersistencia {
  if (respuesta.error) {
    const mensaje =
      respuesta.error !== null && typeof respuesta.error === 'object'
        ? String((respuesta.error as { message?: unknown }).message ?? '').toLowerCase()
        : '';
    // Unico caso distinguido, porque cambia lo que el usuario puede hacer
    // (ya tiene diagnostico: reintentar no lo resolveria). El mensaje
    // crudo se inspecciona para clasificar, nunca se reenvia.
    if (mensaje.includes('ya tiene un diagnostico')) return 'diagnostico_existente';
    return 'no_persistido';
  }

  const filas = Array.isArray(respuesta.data) ? respuesta.data : [];
  if (filas.length === 0) return 'no_persistido';

  return 'persistido';
}

export type ResultadoUsuario =
  | { estado: 'autenticado'; usuarioId: string }
  | { estado: 'sin_sesion' };

export interface DependenciasUsuario {
  getUser: (token: string) => Promise<{ data: { user: { id?: unknown } | null }; error: unknown }>;
}

// Verificacion POSITIVA de identidad en el servidor.
//
// Importante: se valida el token contra el servidor de Auth de Supabase
// (getUser(jwt)), no decodificandolo localmente. El navegador nunca envia
// un "usuarioId": el identificador se obtiene exclusivamente de esta
// comprobacion, de modo que un cliente no puede suplantar a otro usuario
// manipulando el cuerpo de la peticion.
export async function verificarUsuario(
  token: string,
  dependencias: DependenciasUsuario
): Promise<ResultadoUsuario> {
  try {
    const { data, error } = await dependencias.getUser(token);
    if (error) return { estado: 'sin_sesion' };
    const id = data?.user?.id;
    if (typeof id !== 'string' || id.length === 0) return { estado: 'sin_sesion' };
    return { estado: 'autenticado', usuarioId: id };
  } catch {
    return { estado: 'sin_sesion' };
  }
}
