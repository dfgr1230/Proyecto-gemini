// Persistencia del ciclo adaptativo: prevencion de duplicados al
// registrar el intento, y conservacion del analisis en Supabase.
//
// Funciones puras con la forma cruda de supabase-js ({ data, error })
// como entrada, igual que interpretarResultadoPersistencia en
// src/lib/supabase/servidor.ts. Asi todas las decisiones sobre "que
// significa esta respuesta" se prueban con dobles locales.

import type { IntentoRegistrado } from '../actividad/contrato.ts';
import type { AnalisisAdaptativo } from './contrato.ts';
import type { MetadatosLlamada } from '../gemini/cliente.ts';

// ----------------------------------------------------------------
// 1. Prevencion de duplicados ante reintentos
//
// El esquema vigente NO ofrece ninguna restriccion UNIQUE sobre
// public.intentos, y crear una exigiria una migracion nueva. Por eso la
// prevencion se apoya en lo que el esquema SI da: la policy
// intentos_select_propio permite releer los intentos del propio usuario
// antes de escribir.
//
// Regla: si ya existe un intento de este usuario sobre el MISMO ejercicio
// con la MISMA respuesta, no se registra otro -- se reutiliza el que ya
// hay. Un reintento de red, un doble clic o un refresco que reenvie la
// peticion producen entonces una sola fila.
//
// Se eligio la pareja (ejercicio, respuesta) y no solo el ejercicio a
// proposito: un segundo intento con una respuesta DISTINTA es evidencia
// pedagogica nueva y legitima, y debe registrarse. Repetir exactamente la
// misma respuesta no aporta ninguna evidencia nueva.
//
// Limite explicito y conocido: esto no es una garantia transaccional. Dos
// peticiones verdaderamente simultaneas podrian pasar ambas la lectura
// antes de que ninguna escriba. Cerrar esa ventana requiere un indice
// unico en la base de datos, que es parte del paso manual pendiente.
// ----------------------------------------------------------------

export type DeteccionDuplicado =
  | { estado: 'duplicado'; intento: IntentoRegistrado }
  | { estado: 'nuevo' };

export function detectarIntentoDuplicado(
  intentos: readonly IntentoRegistrado[],
  ejercicioId: string,
  respuestaDada: string
): DeteccionDuplicado {
  // Se normaliza igual que registrar_intento() en 0001: recorte de
  // espacios e insensible a mayusculas. Si se comparara de forma mas
  // estricta que la base de datos, "a" y "A" contarian como intentos
  // distintos aunque la RPC los califique identico.
  const objetivo = respuestaDada.trim().toLowerCase();

  for (const intento of intentos) {
    if (intento.ejercicio_id !== ejercicioId) continue;
    const previa = (intento.respuesta_dada ?? '').trim().toLowerCase();
    if (previa === objetivo) return { estado: 'duplicado', intento };
  }

  return { estado: 'nuevo' };
}

// ----------------------------------------------------------------
// 2. Conservacion del analisis
//
// El analisis se guarda mediante una RPC dedicada, por el mismo motivo
// por el que 0004 no abrio un UPDATE sobre perfil_detectado: si el
// navegador pudiera escribir directamente en la tabla, podria almacenar
// cualquier JSON como si fuera una decision de Gemini.
//
// ESTADO REAL HOY: esa RPC todavia NO existe en el proyecto remoto (ver
// docs/PROGRESO.md y el paso manual pendiente). Por eso se distingue
// explicitamente "almacen_no_disponible" de "no_conservado": el primero
// es una carencia conocida de infraestructura y la interfaz debe decirlo
// tal cual; el segundo es un fallo. Colapsar ambos en "error" haria
// parecer roto algo que simplemente no esta instalado, y -- peor --
// mostrar "conservado" en cualquiera de los dos casos seria fingir una
// adaptacion persistida que no ocurrio.
// ----------------------------------------------------------------

export const NOMBRE_RPC_ANALISIS = 'guardar_analisis_adaptativo';

export type ResultadoConservacion =
  | 'conservado'
  // El almacen todavia no existe en la base de datos remota.
  | 'almacen_no_disponible'
  // El almacen existe, pero el servidor no tiene la credencial que la RPC
  // exige. Se distingue del anterior porque la accion correctiva es otra:
  // alli falta aplicar una migracion, aqui falta configurar una variable.
  | 'credencial_ausente'
  | 'no_conservado';

// Codigo de PostgREST cuando la funcion no existe en la cache de esquema.
const CODIGO_FUNCION_INEXISTENTE = 'PGRST202';
// Codigo de PostgreSQL cuando la funcion existe pero el rol no puede
// ejecutarla. Se trata igual que "no instalada": desde el punto de vista
// del producto, el almacen no esta disponible.
const CODIGO_PERMISO_DENEGADO = '42501';
// Codigo propio de servidorPrivilegiado.ts cuando no hay credencial.
const CODIGO_CREDENCIAL_AUSENTE = 'CONFIG_CREDENCIAL_AUSENTE';

export function interpretarResultadoConservacion(respuesta: {
  data: unknown;
  error: unknown;
}): ResultadoConservacion {
  if (respuesta.error) {
    const error = respuesta.error as { code?: unknown; message?: unknown } | null;
    const codigo = error !== null && typeof error === 'object' ? String(error.code ?? '') : '';
    if (codigo === CODIGO_CREDENCIAL_AUSENTE) return 'credencial_ausente';
    if (codigo === CODIGO_FUNCION_INEXISTENTE || codigo === CODIGO_PERMISO_DENEGADO) {
      return 'almacen_no_disponible';
    }
    return 'no_conservado';
  }

  // Mismo criterio que en todo el proyecto: no se declara exito sin
  // evidencia positiva de la fila creada. Error nulo con cero filas es un
  // fallo, no un exito silencioso.
  const filas = Array.isArray(respuesta.data) ? respuesta.data : [];
  if (filas.length === 0) return 'no_conservado';

  const primera = filas[0];
  if (primera === null || typeof primera !== 'object') return 'no_conservado';
  const id = (primera as { analisis_id?: unknown }).analisis_id;
  if (typeof id !== 'string' || id.length === 0) return 'no_conservado';

  return 'conservado';
}

// Parametros de la RPC.
//
// NO se envia usuario_id: la identidad sale de auth.uid() dentro de la
// funcion, igual que en registrar_intento() y en
// guardar_diagnostico_con_perfil(). Enviarlo abriria la puerta a escribir
// el historial de otra persona.
//
// p_intento_id es lo que RELACIONA cada actualizacion del perfil con la
// evidencia que la origino: sin el, el historial diria "el nivel cambio a
// 2" sin poder demostrar por que.
// Los metadatos son OBLIGATORIOS al conservar, y la columna es NOT NULL.
// No es un capricho: son la unica evidencia estructurada de que hubo una
// llamada real al proveedor. Permitir conservar un analisis sin ellos
// abriria la via de guardar una decision "de Gemini" sin ni siquiera
// afirmar que se llamo a Gemini. Cuando no hay metadatos, el ciclo NO
// persiste y lo declara.
export interface ParametrosAnalisis {
  p_intento_id: string;
  p_analisis: AnalisisAdaptativo;
  p_metadatos: {
    modelo: string;
    duracion_ms: number;
    motivo_finalizacion: string | null;
    caracteres_respuesta: number;
  };
}

export function construirParametrosAnalisis(
  intentoId: string,
  analisis: AnalisisAdaptativo,
  metadatos: MetadatosLlamada
): ParametrosAnalisis {
  return {
    p_intento_id: intentoId,
    p_analisis: analisis,
    // Los metadatos se copian campo a campo, no con "spread": asi, si en
    // el futuro alguien anadiera algo sensible a MetadatosLlamada, no
    // acabaria persistido sin decision explicita.
    p_metadatos: {
      modelo: metadatos.modelo,
      duracion_ms: metadatos.duracion_ms,
      motivo_finalizacion: metadatos.motivo_finalizacion,
      caracteres_respuesta: metadatos.caracteres_respuesta,
    },
  };
}

// Lectura del analisis vigente ya conservado. Se vuelve a validar con el
// MISMO contrato antes de usarlo como contexto: la fila pudo escribirse
// por otra via, y confiar en la base de datos como si fuera codigo propio
// seria un error (mismo criterio que consultarPerfilPropio).
export type ResultadoConsultaAnalisis =
  | { estado: 'con_analisis'; analisis: AnalisisAdaptativo }
  | { estado: 'sin_analisis' }
  | { estado: 'almacen_no_disponible' }
  | { estado: 'error' };

export function interpretarConsultaAnalisis(
  respuesta: { data: unknown; error: unknown },
  validar: (crudo: unknown) => { valido: true; analisis: AnalisisAdaptativo } | { valido: false }
): ResultadoConsultaAnalisis {
  if (respuesta.error) {
    const error = respuesta.error as { code?: unknown } | null;
    const codigo = error !== null && typeof error === 'object' ? String(error.code ?? '') : '';
    // PGRST205: la tabla no existe en la cache de esquema.
    if (codigo === 'PGRST205' || codigo === CODIGO_PERMISO_DENEGADO) {
      return { estado: 'almacen_no_disponible' };
    }
    return { estado: 'error' };
  }

  const filas = Array.isArray(respuesta.data) ? respuesta.data : [];
  if (filas.length === 0) return { estado: 'sin_analisis' };

  const primera = filas[0];
  if (primera === null || typeof primera !== 'object') return { estado: 'error' };

  const crudo = (primera as { analisis?: unknown }).analisis;
  const validacion = validar(crudo);
  if (!validacion.valido) return { estado: 'error' };

  return { estado: 'con_analisis', analisis: validacion.analisis };
}
