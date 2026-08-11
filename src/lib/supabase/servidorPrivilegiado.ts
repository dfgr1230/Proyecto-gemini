// Cliente de Supabase con credencial de SERVIDOR, para UNA sola cosa.
//
// Existe para cerrar el hueco de procedencia del ciclo adaptativo. Con la
// clave publicable, "authenticated" conserva EXECUTE sobre la RPC de
// conservacion, de modo que cualquier usuario puede invocarla desde la
// consola del navegador y colgar de su propio intento un JSON con la
// forma correcta que Gemini nunca produjo. La barrera no puede vivir en
// la validacion: un JSON inventado con la forma correcta la supera.
//
// La unica forma de exigir "esto lo escribio el servidor" es que el
// servidor presente algo que el navegador no tiene. Por eso la RPC deja
// de estar concedida a anon y a authenticated, y solo la ejecuta este
// modulo.
//
// ALCANCE DELIBERADAMENTE MINIMO. Este archivo:
//   - es el UNICO del proyecto que lee SUPABASE_SECRET_KEY;
//   - exporta UNA sola funcion, que hace UNA sola llamada RPC;
//   - no consulta ninguna tabla, no lee ni escribe intentos, diagnosticos
//     ni ejercicios, y no expone el cliente que construye.
// Todo lo demas del ciclo -- leer el perfil, el banco, el historial y
// registrar el intento -- sigue pasando por el cliente atado al token del
// usuario, de modo que las policies RLS siguen siendo la autorizacion
// real y las respuestas y calificaciones originales se siguen escribiendo
// con la identidad del propio estudiante.
//
// Hay pruebas estaticas que fallan si alguna de esas condiciones deja de
// cumplirse (ver src/lib/adaptativo/ciclo.test.mjs).

import { createClient } from '@supabase/supabase-js';
import { NOMBRE_RPC_ANALISIS, type ParametrosAnalisis } from '../adaptativo/persistencia.ts';

// Guardia defensiva: si este modulo llegara a evaluarse en un navegador,
// se detiene antes de intentar leer nada del entorno.
if (typeof window !== 'undefined') {
  throw new Error('El cliente privilegiado de Supabase no puede ejecutarse en el navegador.');
}

// Nombre SIN el prefijo NEXT_PUBLIC_, a proposito: Next.js solo incluye
// en el bundle del navegador las variables con ese prefijo. Un import
// accidental desde cliente haria que llegara como undefined y la llamada
// fallara de forma ruidosa, en vez de filtrar el secreto.
const NOMBRE_VARIABLE_SECRETA = 'SUPABASE_SECRET_KEY';

// Codigo interno para "no hay credencial configurada". No es un fallo:
// es el estado real mientras la credencial no exista. La aplicacion lo
// distingue de un error y lo declara en la interfaz en vez de fingir que
// el analisis quedo conservado.
export const CODIGO_CREDENCIAL_AUSENTE = 'CONFIG_CREDENCIAL_AUSENTE';

export function hayCredencialDeServidor(): boolean {
  const clave = process.env[NOMBRE_VARIABLE_SECRETA];
  return typeof clave === 'string' && clave.trim().length > 0;
}

// Conserva el analisis. Es la UNICA operacion privilegiada del proyecto.
//
// Devuelve la forma cruda de supabase-js ({ data, error }) para que
// interpretarResultadoConservacion() decida su significado, igual que con
// el resto de llamadas del ciclo.
export async function conservarAnalisisConCredencialDeServidor(
  parametros: ParametrosAnalisis
): Promise<{ data: unknown; error: unknown }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clave = process.env[NOMBRE_VARIABLE_SECRETA];

  if (!url || !clave || clave.trim().length === 0) {
    // Se registra unicamente el hecho de que falta, nunca su valor ni su
    // longitud.
    console.warn(`[ciclo] ${NOMBRE_VARIABLE_SECRETA} no configurada: el analisis no se conservara.`);
    return { data: null, error: { code: CODIGO_CREDENCIAL_AUSENTE } };
  }

  const cliente = createClient(url, clave, {
    // Sin sesion persistida y sin refresco: este cliente vive lo que dura
    // una peticion y no representa a ningun usuario.
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const respuesta = await cliente.rpc(NOMBRE_RPC_ANALISIS, { ...parametros });
  return { data: respuesta.data, error: respuesta.error };
}
