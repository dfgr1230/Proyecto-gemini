// EL CICLO ADAPTATIVO COMPLETO, en una funcion pura de orquestacion.
//
// Toda la entrada/salida llega como dependencias inyectadas (leer perfil,
// leer intentos, registrar intento, analizar con Gemini, conservar el
// analisis). La ruta de API de src/app/api/adaptar/route.ts se limita a
// atar esas dependencias a Supabase y a Gemini reales.
//
// El motivo de separarlo asi no es estetico: es lo que permite ejecutar
// DOS ITERACIONES CONSECUTIVAS del ciclo en una prueba local, sin red y
// sin base de datos, y comprobar que la segunda usa de verdad el
// resultado de la primera.
//
// Orden de las operaciones, deliberado:
//   1. perfil vigente        -- sin punto de partida no hay adaptacion;
//   2. banco e historial     -- la evidencia previa, restringida por RLS;
//   3. registro del intento  -- ANTES del analisis: la respuesta del
//                               estudiante es el dato duro y no debe
//                               perderse si el proveedor falla despues;
//   4. analisis con Gemini   -- sobre perfil + historial + evidencia nueva;
//   5. validacion            -- ya hecha dentro de generarAnalisis*;
//   6. conservacion          -- solo un analisis valido llega aqui;
//   7. siguiente actividad   -- elegida con la recomendacion del analisis.
//
// Nota sobre el paso 3: es la inversion consciente del criterio que sigue
// /api/perfil, donde se persiste al final. Alli, persistir antes gastaria
// el unico diagnostico que el esquema admite por usuario. Aqui no hay
// nada equivalente que gastar, y perder la respuesta del estudiante
// porque el proveedor tuvo un mal minuto seria mucho peor: las respuestas
// y calificaciones originales son la fuente de verdad del sistema.

import {
  validarEjercicio,
  type EjercicioDisponible,
  type IntentoRegistrado,
} from '../actividad/contrato.ts';
import type { PerfilDetectado } from '../diagnostico/contrato.ts';
import type { ResultadoConsultaPerfil } from '../diagnostico/consulta.ts';
import { validarAnalisisAdaptativo, type AnalisisAdaptativo } from './contrato.ts';
import { construirContextoAnalisis } from './evidencia.ts';
import type { ResultadoAnalisis } from './analisis.ts';
import type { MetadatosLlamada } from '../gemini/cliente.ts';
import {
  construirParametrosAnalisis,
  detectarIntentoDuplicado,
  interpretarConsultaAnalisis,
  interpretarResultadoConservacion,
  type ParametrosAnalisis,
  type ResultadoConservacion,
} from './persistencia.ts';
import { seleccionarSiguienteActividad, type SeleccionSiguiente } from './siguiente.ts';

export interface EntradaCiclo {
  ejercicioId: string;
  respuestaDada: string;
  tiempoRespuesta: number | null;
}

type RespuestaCruda = { data: unknown; error: unknown };

export interface DependenciasCiclo {
  leerPerfil: () => Promise<ResultadoConsultaPerfil>;
  leerEjercicios: () => Promise<RespuestaCruda>;
  leerIntentos: () => Promise<RespuestaCruda>;
  leerAnalisisVigente: () => Promise<RespuestaCruda>;
  registrarIntento: (parametros: {
    p_ejercicio_id: string;
    p_respuesta_dada: string;
    p_tiempo_respuesta: number | null;
  }) => Promise<RespuestaCruda>;
  conservarAnalisis: (parametros: ParametrosAnalisis) => Promise<RespuestaCruda>;
  analizar: (contexto: ReturnType<typeof construirContextoAnalisis>) => Promise<ResultadoAnalisis>;
}

export type CodigoErrorCiclo =
  | 'sin_perfil'
  | 'perfil_incompleto'
  | 'lectura_fallida'
  | 'ejercicio_desconocido'
  | 'respuesta_invalida'
  | 'intento_no_registrado'
  | 'analisis_no_disponible';

export interface IntentoDelCiclo {
  id: string;
  correcto: boolean;
  // true cuando se reutilizo un intento identico ya registrado en vez de
  // crear una fila nueva (ver detectarIntentoDuplicado).
  reutilizado: boolean;
}

export type ResultadoCiclo =
  | {
      estado: 'ok';
      intento: IntentoDelCiclo;
      analisis: AnalisisAdaptativo;
      analisisPrevio: AnalisisAdaptativo | null;
      conservacion: ResultadoConservacion;
      metadatos: MetadatosLlamada | null;
      siguiente: SeleccionSiguiente;
      iteracion: number;
      perfilBase: PerfilDetectado;
    }
  | {
      estado: 'error';
      codigo: CodigoErrorCiclo;
      // Se expone incluso en el fallo porque cambia lo que la interfaz
      // debe decir: si el intento SI quedo registrado, el estudiante no
      // debe repetir la actividad.
      intento: IntentoDelCiclo | null;
    };

function fallo(codigo: CodigoErrorCiclo, intento: IntentoDelCiclo | null = null): ResultadoCiclo {
  return { estado: 'error', codigo, intento };
}

// Interpreta la respuesta de registrar_intento(). Deliberadamente NO se
// reutiliza interpretarResultadoIntento() de actividad/contrato.ts: aquel
// solo devuelve "correcto", que es cuanto necesita la vista, mientras que
// el ciclo necesita ademas el identificador de la fila para poder
// RELACIONAR el analisis con la evidencia que lo origino.
export function interpretarIntentoRegistrado(
  respuesta: RespuestaCruda
): { estado: 'registrado'; id: string; correcto: boolean; fecha: string } | { estado: 'no_registrado' } {
  if (respuesta.error) return { estado: 'no_registrado' };

  const filas = Array.isArray(respuesta.data) ? respuesta.data : [];
  if (filas.length === 0) return { estado: 'no_registrado' };

  const primera = filas[0];
  if (primera === null || typeof primera !== 'object') return { estado: 'no_registrado' };

  const fila = primera as { intento_id?: unknown; es_correcto?: unknown; fecha?: unknown };
  if (typeof fila.intento_id !== 'string' || fila.intento_id.length === 0) {
    return { estado: 'no_registrado' };
  }
  if (typeof fila.es_correcto !== 'boolean') return { estado: 'no_registrado' };

  return {
    estado: 'registrado',
    id: fila.intento_id,
    correcto: fila.es_correcto,
    fecha: typeof fila.fecha === 'string' ? fila.fecha : new Date().toISOString(),
  };
}

// Convierte las filas crudas de public.intentos en la forma tipada. Una
// fila malformada se descarta: el resto del historial sigue siendo
// evidencia utilizable.
export function normalizarIntentos(crudo: unknown): IntentoRegistrado[] {
  const filas = Array.isArray(crudo) ? crudo : [];
  const intentos: IntentoRegistrado[] = [];

  for (const fila of filas) {
    if (fila === null || typeof fila !== 'object') continue;
    const f = fila as Record<string, unknown>;
    if (typeof f.id !== 'string' || typeof f.ejercicio_id !== 'string') continue;
    if (typeof f.correcto !== 'boolean' || typeof f.fecha !== 'string') continue;
    intentos.push({
      id: f.id,
      ejercicio_id: f.ejercicio_id,
      correcto: f.correcto,
      fecha: f.fecha,
      tiempo_respuesta: typeof f.tiempo_respuesta === 'number' ? f.tiempo_respuesta : null,
      respuesta_dada: typeof f.respuesta_dada === 'string' ? f.respuesta_dada : null,
    });
  }

  return intentos;
}

export function normalizarEjercicios(crudo: unknown): EjercicioDisponible[] {
  const filas = Array.isArray(crudo) ? crudo : [];
  const ejercicios: EjercicioDisponible[] = [];
  for (const fila of filas) {
    const validacion = validarEjercicio(fila);
    if (validacion.valido) ejercicios.push(validacion.ejercicio);
  }
  return ejercicios;
}

export async function ejecutarCicloAdaptativo(
  entrada: EntradaCiclo,
  dependencias: DependenciasCiclo
): Promise<ResultadoCiclo> {
  // --- 1. Perfil vigente ---
  const perfil = await dependencias.leerPerfil();
  if (perfil.estado === 'sin_diagnostico') return fallo('sin_perfil');
  if (perfil.estado !== 'con_perfil') return fallo('perfil_incompleto');

  // --- 2. Banco e historial (ambos restringidos por RLS) ---
  const [respEjercicios, respIntentos] = await Promise.all([
    dependencias.leerEjercicios(),
    dependencias.leerIntentos(),
  ]);
  if (respEjercicios.error || respIntentos.error) return fallo('lectura_fallida');

  const ejercicios = normalizarEjercicios(respEjercicios.data);
  const intentosPrevios = normalizarIntentos(respIntentos.data);

  const ejercicio = ejercicios.find((e) => e.id === entrada.ejercicioId);
  if (!ejercicio) return fallo('ejercicio_desconocido');

  // La respuesta debe ser una de las opciones publicadas de ESE
  // ejercicio. No es una comprobacion de correccion -- eso lo decide
  // PostgreSQL -- sino de que el cuerpo de la peticion sea coherente con
  // lo que se mostro.
  const respuesta = entrada.respuestaDada.trim();
  if (respuesta.length === 0 || !(respuesta in ejercicio.contenido.opciones)) {
    return fallo('respuesta_invalida');
  }

  // --- 3. Registro del intento, con prevencion de duplicados ---
  const duplicado = detectarIntentoDuplicado(intentosPrevios, ejercicio.id, respuesta);

  let intentoDelCiclo: IntentoDelCiclo;
  let intentos: IntentoRegistrado[];

  if (duplicado.estado === 'duplicado') {
    // Reintento identico: no se crea una segunda fila. El ciclo continua
    // con el intento que ya existia, de modo que la respuesta al usuario
    // es la misma que la primera vez.
    intentoDelCiclo = {
      id: duplicado.intento.id,
      correcto: duplicado.intento.correcto,
      reutilizado: true,
    };
    intentos = intentosPrevios;
  } else {
    const registro = interpretarIntentoRegistrado(
      await dependencias.registrarIntento({
        // Solo los parametros que la RPC admite. No se envia "correcto"
        // ni "usuario_id": lo primero lo decide la base de datos
        // comparando contra ejercicios_respuestas, lo segundo sale de
        // auth.uid() dentro de la funcion.
        p_ejercicio_id: ejercicio.id,
        p_respuesta_dada: respuesta,
        p_tiempo_respuesta: entrada.tiempoRespuesta,
      })
    );
    if (registro.estado === 'no_registrado') return fallo('intento_no_registrado');

    intentoDelCiclo = { id: registro.id, correcto: registro.correcto, reutilizado: false };
    intentos = [
      ...intentosPrevios,
      {
        id: registro.id,
        ejercicio_id: ejercicio.id,
        correcto: registro.correcto,
        fecha: registro.fecha,
        tiempo_respuesta: entrada.tiempoRespuesta,
        respuesta_dada: respuesta,
      },
    ];
  }

  // --- 4. Contexto y analisis con Gemini ---
  const consultaPrevia = interpretarConsultaAnalisis(
    await dependencias.leerAnalisisVigente(),
    validarAnalisisAdaptativo
  );
  const analisisPrevio =
    consultaPrevia.estado === 'con_analisis' ? consultaPrevia.analisis : null;

  const contexto = construirContextoAnalisis({
    perfilBase: perfil.perfil,
    analisisPrevio,
    intentos,
    ejercicios,
  });

  const resultado = await dependencias.analizar(contexto);
  if (resultado.estado === 'error') {
    // El intento SI quedo registrado. Se informa junto al fallo para que
    // la interfaz muestre un estado recuperable y honesto, en vez de
    // fingir que hubo adaptacion o dar a entender que se perdio todo.
    return fallo('analisis_no_disponible', intentoDelCiclo);
  }

  // --- 5. Conservacion del analisis validado ---
  //
  // Sin metadatos de la llamada NO se conserva. Los metadatos son la
  // unica evidencia estructurada de que hubo una llamada real al
  // proveedor; guardar un analisis sin ellos seria almacenar una decision
  // "de Gemini" sin siquiera afirmar que se llamo a Gemini. Es un estado
  // que la ruta real no produce -- generarAnalisisAdaptativo() siempre los
  // adjunta -- pero se contempla explicitamente en vez de confiar en que
  // nunca ocurra.
  const conservacion: ResultadoConservacion =
    resultado.metadatos === null
      ? 'no_conservado'
      : interpretarResultadoConservacion(
          await dependencias.conservarAnalisis(
            construirParametrosAnalisis(intentoDelCiclo.id, resultado.analisis, resultado.metadatos)
          )
        );

  // --- 6. Siguiente actividad, elegida con la recomendacion ---
  const siguiente = seleccionarSiguienteActividad(ejercicios, resultado.analisis, intentos);

  return {
    estado: 'ok',
    intento: intentoDelCiclo,
    analisis: resultado.analisis,
    analisisPrevio,
    conservacion,
    metadatos: resultado.metadatos,
    siguiente,
    iteracion: contexto.iteracion,
    perfilBase: perfil.perfil,
  };
}
