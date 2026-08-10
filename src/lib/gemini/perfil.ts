// Generacion del perfil educativo a partir del diagnostico (Dia 3).
//
// Este modulo NO llama a Gemini por si mismo: recibe la funcion de
// llamada como dependencia inyectada, igual que src/lib/auth/contrato.ts
// recibe signUp/signInWithPassword. Eso permite probar el flujo completo
// -- incluido el prompt exacto que se envia y el rechazo de respuestas
// invalidas -- sin red y sin clave.
//
// Privacidad del prompt (requisito de la convocatoria y de CLAUDE.md):
// a Gemini se le envian UNICAMENTE los identificadores de pregunta y de
// opcion elegida, mas el texto de las preguntas y opciones del banco
// publico. NUNCA viaja el nombre, el correo, el UUID del usuario, el id
// del diagnostico, ni ningun dato personal o medico.

// Rutas relativas con extension ".ts" (no el alias "@/") para que este
// modulo sea cargable tal cual desde "node --test", sin bundler.
import {
  ESTILOS_APRENDIZAJE,
  PREGUNTAS,
  type EstiloAprendizaje,
} from '../diagnostico/preguntas.ts';
import {
  validarPerfilDetectado,
  CLAVES_PERFIL,
  NIVEL_SUGERIDO_MINIMO,
  NIVEL_SUGERIDO_MAXIMO,
  LONGITUD_MAXIMA_EXPLICACION,
  type PerfilDetectado,
  type RespuestasDiagnostico,
} from '../diagnostico/contrato.ts';
import type { EsquemaRespuesta, ResultadoGemini } from './cliente.ts';

// Esquema exigido al modelo. Refleja exactamente el contrato validado
// despues en validarPerfilDetectado().
export const ESQUEMA_PERFIL: EsquemaRespuesta = {
  type: 'object',
  properties: {
    estilo_aprendizaje: { type: 'string', enum: [...ESTILOS_APRENDIZAJE] },
    nivel_sugerido: {
      type: 'integer',
      minimum: NIVEL_SUGERIDO_MINIMO,
      maximum: NIVEL_SUGERIDO_MAXIMO,
    },
    explicacion: { type: 'string', maxLength: LONGITUD_MAXIMA_EXPLICACION },
  },
  required: [...CLAVES_PERFIL],
  propertyOrdering: [...CLAVES_PERFIL],
};

// Construye el texto enviado al modelo. Se expone para poder afirmar en
// pruebas que el prompt no contiene datos personales.
export function construirInstruccion(respuestas: RespuestasDiagnostico): string {
  const lineas: string[] = [];

  for (const pregunta of PREGUNTAS) {
    const elegida = respuestas[pregunta.id];
    const opcion = pregunta.opciones.find((o) => o.id === elegida);
    // El banco es publico y no contiene datos personales; se incluye el
    // texto para que el modelo tenga contexto pedagogico real.
    lineas.push(`${pregunta.id}. ${pregunta.enunciado} -> ${elegida}) ${opcion ? opcion.texto : ''}`);
  }

  return [
    'Eres un asistente pedagógico. A partir de las respuestas de un estudiante a un cuestionario',
    'de preferencias de aprendizaje, propón una orientación educativa.',
    '',
    'Reglas estrictas:',
    `- "estilo_aprendizaje" debe ser exactamente uno de: ${ESTILOS_APRENDIZAJE.join(', ')}.`,
    `- "nivel_sugerido" debe ser un número entero entre ${NIVEL_SUGERIDO_MINIMO} y ${NIVEL_SUGERIDO_MAXIMO}.`,
    '- "explicacion" debe dirigirse al estudiante en segunda persona, en español, en un máximo de',
    '  dos frases, describiendo cómo aprende mejor y por dónde conviene empezar.',
    '- No emitas diagnósticos clínicos ni psicológicos de ningún tipo.',
    '- No menciones condiciones médicas, trastornos, discapacidades ni terapias.',
    '- No infieras edad, género, origen ni ninguna característica personal.',
    '- Preséntalo como una orientación inicial que puede ajustarse, nunca como una verdad definitiva.',
    '- No añadas ninguna propiedad fuera de las tres indicadas.',
    '',
    'Respuestas del cuestionario:',
    ...lineas,
  ].join('\n');
}

export type ResultadoPerfil =
  | { estado: 'ok'; perfil: PerfilDetectado }
  | { estado: 'error'; categoria: 'configuracion' | 'red' | 'proveedor' | 'respuesta_invalida' };

export interface DependenciasPerfil {
  llamar: (peticion: { instruccion: string; esquema: EsquemaRespuesta }) => Promise<ResultadoGemini>;
}

// Parseo estricto: JSON.parse sobre el texto completo. Si el modelo
// devolviera algo que no es JSON puro, se rechaza -- NO se intenta
// "rescatar" un fragmento con expresiones regulares, porque eso admitiria
// contenido arbitrario alrededor del objeto.
export function interpretarTextoPerfil(texto: string): ResultadoPerfil {
  let crudo: unknown;
  try {
    crudo = JSON.parse(texto);
  } catch {
    return { estado: 'error', categoria: 'respuesta_invalida' };
  }

  const validacion = validarPerfilDetectado(crudo);
  if (!validacion.valido) {
    return { estado: 'error', categoria: 'respuesta_invalida' };
  }
  return { estado: 'ok', perfil: validacion.perfil };
}

export async function generarPerfil(
  respuestas: RespuestasDiagnostico,
  dependencias: DependenciasPerfil
): Promise<ResultadoPerfil> {
  const instruccion = construirInstruccion(respuestas);

  const resultado = await dependencias.llamar({ instruccion, esquema: ESQUEMA_PERFIL });

  if (resultado.estado === 'error') {
    // La categoria del cliente se traslada tal cual salvo
    // 'respuesta_vacia', que aqui equivale a una respuesta inservible.
    if (resultado.categoria === 'respuesta_vacia') {
      return { estado: 'error', categoria: 'respuesta_invalida' };
    }
    return { estado: 'error', categoria: resultado.categoria };
  }

  return interpretarTextoPerfil(resultado.texto);
}

export type { EstiloAprendizaje };
