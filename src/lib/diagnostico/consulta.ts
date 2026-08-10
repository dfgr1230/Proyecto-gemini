// Lectura del diagnostico propio ya persistido (Sprint A, A3).
//
// Mismo patron que contrato.ts y auth/contrato.ts: funcion pura, sin
// React, sin DOM y sin tocar Supabase directamente -- la consulta llega
// como dependencia inyectada, de modo que puede probarse con dobles
// locales, sin red y sin sesion.
//
// Autorizacion: NO hay ningun filtro por usuario en esta capa, y es
// deliberado. La policy diagnosticos_select_propio ya restringe el SELECT
// a auth.uid() = usuario_id; anadir aqui un "usuario_id" tomado del
// navegador daria la falsa impresion de que la seguridad depende del
// cliente. Quien manda sigue siendo RLS.

import { validarPerfilDetectado, type PerfilDetectado } from './contrato.ts';

export type ResultadoConsultaPerfil =
  // Caso normal: hay diagnostico y su perfil supera el contrato.
  | { estado: 'con_perfil'; perfil: PerfilDetectado }
  // El usuario todavia no ha hecho el test.
  | { estado: 'sin_diagnostico' }
  // Existe la fila pero perfil_detectado es null o no supera el
  // contrato. Es un estado real y alcanzable: authenticated conserva
  // INSERT directo sobre (usuario_id, respuestas) -- sin perfil_detectado
  // --, asi que una fila sin perfil puede existir sin pasar por la RPC.
  // No se trata como "sin diagnostico": mandar a /diagnostico a alguien
  // que ya ocupa su unica fila lo dejaria en un bucle imposible de
  // resolver, porque usuario_id es UNIQUE y no hay policy de DELETE.
  | { estado: 'perfil_incompleto' }
  | { estado: 'error' };

export interface DependenciasConsulta {
  // Devuelve la forma cruda de supabase-js: { data, error }.
  //
  // PromiseLike y no Promise a proposito: el constructor de consultas de
  // PostgREST es "thenable" (se puede esperar con await) pero no una
  // Promise completa -- no expone catch ni finally. Exigir Promise
  // obligaria a envolver cada llamada en el componente solo para
  // satisfacer al compilador.
  seleccionar: () => PromiseLike<{ data: unknown; error: unknown }>;
}

export async function consultarPerfilPropio(
  dependencias: DependenciasConsulta
): Promise<ResultadoConsultaPerfil> {
  let respuesta: { data: unknown; error: unknown };
  try {
    respuesta = await dependencias.seleccionar();
  } catch {
    return { estado: 'error' };
  }

  if (respuesta.error) return { estado: 'error' };

  const filas = Array.isArray(respuesta.data) ? respuesta.data : [];
  if (filas.length === 0) return { estado: 'sin_diagnostico' };

  const primera = filas[0];
  if (primera === null || typeof primera !== 'object') return { estado: 'error' };

  const crudo = (primera as { perfil_detectado?: unknown }).perfil_detectado;
  if (crudo === null || crudo === undefined) return { estado: 'perfil_incompleto' };

  // El perfil almacenado se vuelve a validar con el MISMO contrato que se
  // aplico antes de guardarlo. No es redundante: la fila pudo escribirse
  // por otra via, y mostrar sin validar seria confiar en la base de datos
  // como si fuera codigo propio.
  const validacion = validarPerfilDetectado(crudo);
  if (!validacion.valido) return { estado: 'perfil_incompleto' };

  return { estado: 'con_perfil', perfil: validacion.perfil };
}

export const MENSAJE_PERFIL_INCOMPLETO =
  'Tu diagnóstico está registrado, pero su orientación no está disponible. Escríbenos para revisarlo.';
export const MENSAJE_ERROR_CONSULTA =
  'No fue posible cargar tu perfil en este momento. Vuelve a intentarlo en unos segundos.';
