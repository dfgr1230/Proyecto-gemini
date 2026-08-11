// Orquestacion del analisis adaptativo con Gemini.
//
// Mismo patron que src/lib/gemini/perfil.ts: este modulo NO llama a la
// red por si mismo. Recibe la funcion de llamada como dependencia
// inyectada, de modo que el ciclo completo -- incluido el prompt exacto y
// el rechazo de respuestas invalidas -- se prueba sin red y sin clave.
//
// Vive en src/lib/adaptativo/ y no en src/lib/gemini/ porque lo que
// caracteriza a este archivo es la DECISION EDUCATIVA, no el proveedor:
// gemini/cliente.ts sigue siendo el unico punto que conoce la API.

import type { EsquemaRespuesta, MetadatosLlamada, ResultadoGemini } from '../gemini/cliente.ts';
import type { ContextoAnalisis } from './evidencia.ts';
import {
  validarAnalisisAdaptativo,
  CLAVES_ANALISIS,
  MATERIAS,
  NIVELES_CONFIANZA,
  NIVEL_MINIMO,
  NIVEL_MAXIMO,
  MAXIMO_ELEMENTOS_LISTA,
  LONGITUD_MAXIMA_ELEMENTO,
  LONGITUD_MAXIMA_FRASE,
  LONGITUD_MAXIMA_JUSTIFICACION,
  type AnalisisAdaptativo,
} from './contrato.ts';

// Esquema de salida estructurada exigido al modelo. Refleja exactamente
// lo que validarAnalisisAdaptativo() acepta despues -- pedirlo aqui
// reduce las respuestas mal formadas, pero NO sustituye a la validacion:
// el resultado se vuelve a comprobar siempre antes de usarlo o guardarlo.
export const ESQUEMA_ANALISIS: EsquemaRespuesta = {
  type: 'object',
  properties: {
    fortalezas: {
      type: 'array',
      minItems: 1,
      maxItems: MAXIMO_ELEMENTOS_LISTA,
      items: { type: 'string', maxLength: LONGITUD_MAXIMA_ELEMENTO },
    },
    dificultades: {
      type: 'array',
      minItems: 1,
      maxItems: MAXIMO_ELEMENTOS_LISTA,
      items: { type: 'string', maxLength: LONGITUD_MAXIMA_ELEMENTO },
    },
    habilidad_prioritaria: { type: 'string', maxLength: LONGITUD_MAXIMA_ELEMENTO },
    nivel_recomendado: { type: 'integer', minimum: NIVEL_MINIMO, maximum: NIVEL_MAXIMO },
    apoyo_pedagogico: { type: 'string', maxLength: LONGITUD_MAXIMA_FRASE },
    siguiente_actividad_materia: { type: 'string', enum: [...MATERIAS] },
    siguiente_actividad_enfoque: { type: 'string', maxLength: LONGITUD_MAXIMA_FRASE },
    justificacion: { type: 'string', maxLength: LONGITUD_MAXIMA_JUSTIFICACION },
    confianza: { type: 'string', enum: [...NIVELES_CONFIANZA] },
  },
  required: [...CLAVES_ANALISIS],
  propertyOrdering: [...CLAVES_ANALISIS],
};

function describirIntento(e: { orden: number; materia: string; nivel: number; correcto: boolean; segundos: number | null }): string {
  const tiempo = e.segundos === null ? 'sin tiempo registrado' : `${e.segundos} s`;
  return `  ${e.orden}. ${e.materia}, nivel ${e.nivel} -> ${e.correcto ? 'acertó' : 'falló'} (${tiempo})`;
}

// Construye el texto enviado al modelo. Se exporta para poder afirmar en
// pruebas que el prompt no contiene datos personales y que si contiene el
// analisis previo cuando existe.
export function construirInstruccionAnalisis(contexto: ContextoAnalisis): string {
  const lineas: string[] = [
    'Eres un asistente pedagógico que decide el siguiente paso de un estudiante en una',
    'plataforma de ejercicios adaptativos de matemáticas y lenguaje.',
    '',
    'Tu decisión debe basarse EXCLUSIVAMENTE en la evidencia que se te entrega abajo.',
    '',
    'Reglas estrictas:',
    `- "nivel_recomendado" es un entero entre ${NIVEL_MINIMO} y ${NIVEL_MAXIMO} en la misma escala del banco.`,
    `- "siguiente_actividad_materia" debe ser exactamente una de: ${MATERIAS.join(', ')}.`,
    `- "confianza" debe ser exactamente una de: ${NIVELES_CONFIANZA.join(', ')}, y debe ser baja cuando la evidencia es escasa.`,
    '- "justificacion" debe citar la evidencia concreta que la sustenta (nivel, materia, acierto o fallo,',
    '  y el cambio respecto del análisis anterior si lo hay). No inventes evidencia que no aparezca abajo.',
    '- "fortalezas" y "dificultades" describen desempeño observable en las actividades, nunca rasgos de la persona.',
    '- No emitas diagnósticos clínicos ni psicológicos de ningún tipo.',
    '- No menciones condiciones médicas, trastornos, discapacidades ni terapias.',
    '- No infieras edad, género, origen ni ninguna característica personal.',
    '- Escribe en español, dirigiéndote al estudiante en segunda persona cuando corresponda.',
    '- No añadas ninguna propiedad fuera de las nueve indicadas.',
    '',
    'Perfil inicial detectado en el diagnóstico:',
    `- estilo de aprendizaje: ${contexto.perfil_base.estilo_aprendizaje}`,
    `- nivel inicial sugerido: ${contexto.perfil_base.nivel_sugerido}`,
    '',
    `Niveles con actividades disponibles en el banco: ${
      contexto.niveles_disponibles.length > 0 ? contexto.niveles_disponibles.join(', ') : 'ninguno'
    }.`,
    '',
  ];

  if (contexto.analisis_previo === null) {
    lineas.push('Análisis previo: no hay ninguno. Esta es la primera iteración del ciclo.');
  } else {
    const previo = contexto.analisis_previo;
    lineas.push(
      'Análisis previo que tú mismo emitiste en la iteración anterior (debes partir de él y decir qué cambia):',
      `- habilidad prioritaria: ${previo.habilidad_prioritaria}`,
      `- nivel recomendado: ${previo.nivel_recomendado}`,
      `- apoyo pedagógico: ${previo.apoyo_pedagogico}`,
      `- siguiente actividad propuesta: ${previo.siguiente_actividad_materia} — ${previo.siguiente_actividad_enfoque}`,
      `- confianza: ${previo.confianza}`,
      `- dificultades observadas: ${previo.dificultades.join('; ')}`
    );
  }

  lineas.push('', 'Historial de intentos (calificados por la base de datos, no por ti):');
  if (contexto.historial.length === 0) {
    lineas.push('  (sin intentos registrados)');
  } else {
    for (const intento of contexto.historial) lineas.push(describirIntento(intento));
  }

  if (contexto.evidencia_nueva !== null) {
    lineas.push(
      '',
      `Evidencia NUEVA que motiva este análisis: intento ${contexto.evidencia_nueva.orden}, ` +
        `${contexto.evidencia_nueva.materia}, nivel ${contexto.evidencia_nueva.nivel}, ` +
        `${contexto.evidencia_nueva.correcto ? 'acertó' : 'falló'}.`
    );
  }

  return lineas.join('\n');
}

// "metadatos" es null cuando el analisis se obtuvo interpretando un texto
// suelto (pruebas, o un reintento sobre un texto ya recibido) y trae los
// datos reales de la llamada cuando vino de generarAnalisisAdaptativo().
export type ResultadoAnalisis =
  | { estado: 'ok'; analisis: AnalisisAdaptativo; metadatos: MetadatosLlamada | null }
  | { estado: 'error'; categoria: 'configuracion' | 'red' | 'proveedor' | 'respuesta_invalida' };

export interface DependenciasAnalisis {
  llamar: (peticion: {
    instruccion: string;
    esquema: EsquemaRespuesta;
  }) => Promise<ResultadoGemini>;
}

// Parseo estricto: JSON.parse sobre el texto completo. Si el modelo
// devolviera algo que no es JSON puro se rechaza -- NO se intenta
// rescatar un fragmento con expresiones regulares, porque eso admitiria
// contenido arbitrario alrededor del objeto.
export function interpretarTextoAnalisis(texto: string): ResultadoAnalisis {
  let crudo: unknown;
  try {
    crudo = JSON.parse(texto);
  } catch {
    return { estado: 'error', categoria: 'respuesta_invalida' };
  }

  const validacion = validarAnalisisAdaptativo(crudo);
  if (!validacion.valido) {
    return { estado: 'error', categoria: 'respuesta_invalida' };
  }
  return { estado: 'ok', analisis: validacion.analisis, metadatos: null };
}

export async function generarAnalisisAdaptativo(
  contexto: ContextoAnalisis,
  dependencias: DependenciasAnalisis
): Promise<ResultadoAnalisis> {
  const instruccion = construirInstruccionAnalisis(contexto);

  const resultado = await dependencias.llamar({ instruccion, esquema: ESQUEMA_ANALISIS });

  if (resultado.estado === 'error') {
    if (resultado.categoria === 'respuesta_vacia') {
      return { estado: 'error', categoria: 'respuesta_invalida' };
    }
    return { estado: 'error', categoria: resultado.categoria };
  }

  const interpretado = interpretarTextoAnalisis(resultado.texto);
  if (interpretado.estado === 'error') return interpretado;

  // Los metadatos se adjuntan SOLO cuando el analisis ya paso la
  // validacion: no tiene sentido presentar como evidencia de uso de IA
  // una llamada cuyo resultado se descarto.
  return { estado: 'ok', analisis: interpretado.analisis, metadatos: resultado.metadatos };
}
