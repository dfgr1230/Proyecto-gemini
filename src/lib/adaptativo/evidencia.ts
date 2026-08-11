// Construccion del CONTEXTO que se envia a Gemini en cada iteracion del
// ciclo adaptativo.
//
// Funcion de este modulo: decidir QUE evidencia viaja al modelo y en que
// forma. Es un archivo separado del contrato porque responde una pregunta
// distinta -- el contrato valida lo que Gemini DEVUELVE, esto prepara lo
// que Gemini RECIBE -- y porque es exactamente aqui donde se cumple el
// limite de privacidad.
//
// LIMITE DE PRIVACIDAD (requisito de la convocatoria y de CLAUDE.md):
// al modelo NUNCA viajan el nombre, el correo, el UUID del usuario, el id
// del diagnostico ni las fechas absolutas. Lo unico que sale es evidencia
// pedagogica: materia, nivel, si acerto, cuanto tardo y el orden de los
// intentos. Hay una prueba que recorre el contexto construido y falla si
// aparece cualquiera de esos campos.
//
// FUENTE DE VERDAD: las calificaciones vienen de public.intentos, que solo
// se escribe desde registrar_intento() -- es decir, las decide PostgreSQL
// comparando contra ejercicios_respuestas. Este modulo las LEE y las
// resume; no las recalcula, no las corrige y no las pondera.

import type { EjercicioDisponible, IntentoRegistrado } from '../actividad/contrato.ts';
import type { PerfilDetectado } from '../diagnostico/contrato.ts';
import type { AnalisisAdaptativo } from './contrato.ts';

// Cuantos intentos se envian como historial. Se limita a proposito: el
// ciclo debe razonar sobre la evidencia reciente, y un historial sin
// tope haria crecer el prompt (y el coste) sin mejorar la decision.
export const MAXIMO_INTENTOS_EN_CONTEXTO = 10;

// Un intento ya cruzado con el banco de ejercicios. "orden" es la
// posicion cronologica (1 = el mas antiguo de los enviados): sustituye a
// la fecha absoluta, que no aporta nada pedagogico y si es un dato mas
// sobre la persona.
export interface EvidenciaIntento {
  orden: number;
  materia: string;
  nivel: number;
  correcto: boolean;
  segundos: number | null;
}

export interface ContextoAnalisis {
  // Perfil inicial generado por Gemini en el diagnostico. Es el punto de
  // partida del ciclo y se envia siempre, para que el analisis nuevo sea
  // una evolucion de algo y no una lectura aislada.
  perfil_base: {
    estilo_aprendizaje: string;
    nivel_sugerido: number;
  };
  // Analisis anterior del propio ciclo, si existe. null en la primera
  // iteracion. Es lo que convierte la cadena en acumulativa.
  analisis_previo: AnalisisAdaptativo | null;
  // Numero de iteracion que se esta resolviendo (1 = la primera).
  iteracion: number;
  historial: EvidenciaIntento[];
  // Ultimo intento, destacado aparte: es la evidencia NUEVA que dispara
  // este analisis concreto.
  evidencia_nueva: EvidenciaIntento | null;
  // Niveles que realmente existen en el banco. Sin esto, el modelo puede
  // recomendar un nivel para el que no hay ninguna actividad.
  niveles_disponibles: number[];
}

// Cruza los intentos persistidos con el banco de ejercicios para obtener
// materia y nivel. Un intento cuyo ejercicio ya no este en el banco se
// DESCARTA en vez de inventarle un nivel: enviar un dato fabricado como
// evidencia seria peor que enviar menos evidencia.
export function construirEvidencia(
  intentos: readonly IntentoRegistrado[],
  ejercicios: readonly EjercicioDisponible[]
): EvidenciaIntento[] {
  const porId = new Map(ejercicios.map((e) => [e.id, e]));

  const ordenados = [...intentos].sort((a, b) => {
    const porFecha = a.fecha.localeCompare(b.fecha);
    // Desempate estable por id: dos intentos con la misma marca de tiempo
    // deben ordenarse siempre igual, o el contexto cambiaria entre
    // llamadas sin que haya cambiado nada real.
    return porFecha !== 0 ? porFecha : a.id.localeCompare(b.id);
  });

  const recientes = ordenados.slice(-MAXIMO_INTENTOS_EN_CONTEXTO);

  const evidencia: EvidenciaIntento[] = [];
  for (const intento of recientes) {
    const ejercicio = porId.get(intento.ejercicio_id);
    if (!ejercicio) continue;
    evidencia.push({
      orden: evidencia.length + 1,
      materia: ejercicio.materia,
      nivel: ejercicio.nivel_dificultad,
      correcto: intento.correcto,
      segundos:
        typeof intento.tiempo_respuesta === 'number' && Number.isFinite(intento.tiempo_respuesta)
          ? intento.tiempo_respuesta
          : null,
    });
  }

  return evidencia;
}

export function construirContextoAnalisis(entrada: {
  perfilBase: PerfilDetectado;
  analisisPrevio: AnalisisAdaptativo | null;
  intentos: readonly IntentoRegistrado[];
  ejercicios: readonly EjercicioDisponible[];
}): ContextoAnalisis {
  const historial = construirEvidencia(entrada.intentos, entrada.ejercicios);

  const niveles = [...new Set(entrada.ejercicios.map((e) => e.nivel_dificultad))].sort(
    (a, b) => a - b
  );

  return {
    perfil_base: {
      estilo_aprendizaje: entrada.perfilBase.estilo_aprendizaje,
      nivel_sugerido: entrada.perfilBase.nivel_sugerido,
      // La explicacion del perfil NO se reenvia: es un texto dirigido al
      // estudiante, no evidencia. Enviarla solo alargaria el prompt.
    },
    analisis_previo: entrada.analisisPrevio,
    // La iteracion se deriva del historial real, no de un contador que el
    // navegador pudiera enviar.
    iteracion: historial.length,
    historial,
    evidencia_nueva: historial.length > 0 ? historial[historial.length - 1] : null,
    niveles_disponibles: niveles,
  };
}
