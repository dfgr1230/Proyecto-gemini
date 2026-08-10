// Contrato del diagnostico (Dia 3): validacion de las respuestas del
// estudiante y validacion del perfil devuelto por Gemini.
//
// Mismo patron que src/lib/auth/contrato.ts: funciones puras, sin React,
// sin DOM y sin tocar Supabase ni Gemini directamente, para poder probarse
// con dobles locales. Este archivo se usa en LOS DOS lados: el navegador
// lo utiliza para no dejar enviar un formulario incompleto, y la ruta de
// servidor lo vuelve a ejecutar sobre lo que realmente llego -- la
// validacion del navegador es comodidad, la del servidor es la que manda.

// Los imports internos llevan la extension ".ts" a proposito: asi el
// mismo modulo se puede cargar tanto desde Next como desde "node --test"
// (el resolvedor ESM de Node exige la extension y no conoce el alias "@/").
import { PREGUNTAS, ESTILOS_APRENDIZAJE, CANTIDAD_PREGUNTAS, type EstiloAprendizaje } from './preguntas.ts';

// Indice pregunta -> conjunto de opciones validas, construido UNA vez a
// partir del banco real. Evita listas duplicadas que puedan desincronizarse.
const OPCIONES_POR_PREGUNTA: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  PREGUNTAS.map((pregunta) => [pregunta.id, new Set(pregunta.opciones.map((opcion) => opcion.id))])
);

export type RespuestasDiagnostico = Record<string, string>;

export type MotivoRespuestasInvalidas =
  | 'no_es_objeto'
  | 'cantidad_incorrecta'
  | 'pregunta_desconocida'
  | 'pregunta_faltante'
  | 'opcion_desconocida'
  | 'valor_no_texto';

export type ValidacionRespuestas =
  | { valido: true; respuestas: RespuestasDiagnostico }
  | { valido: false; motivo: MotivoRespuestasInvalidas; detalle: string };

// Valida la estructura completa de las respuestas. Rechaza explicitamente:
// faltantes, cantidad distinta de 12, identificadores de pregunta que no
// existen en el banco, opciones que no pertenecen a esa pregunta concreta,
// y cualquier valor que no sea un string (el navegador no puede colar
// texto libre, numeros ni objetos).
//
// Nota sobre duplicados: un objeto JSON no puede tener la misma clave dos
// veces -- JSON.parse conserva la ultima. Por eso "12 claves exactas" +
// "todas conocidas" ya implica que no hay preguntas repetidas ni faltantes.
export function validarRespuestasDiagnostico(valor: unknown): ValidacionRespuestas {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) {
    return { valido: false, motivo: 'no_es_objeto', detalle: 'Las respuestas deben ser un objeto.' };
  }

  const entradas = Object.entries(valor as Record<string, unknown>);

  if (entradas.length !== CANTIDAD_PREGUNTAS) {
    return {
      valido: false,
      motivo: 'cantidad_incorrecta',
      detalle: `Se esperaban ${CANTIDAD_PREGUNTAS} respuestas y llegaron ${entradas.length}.`,
    };
  }

  const respuestas: RespuestasDiagnostico = {};

  for (const [idPregunta, respuesta] of entradas) {
    const opcionesValidas = OPCIONES_POR_PREGUNTA.get(idPregunta);
    if (!opcionesValidas) {
      return {
        valido: false,
        motivo: 'pregunta_desconocida',
        detalle: `La pregunta "${idPregunta}" no pertenece al diagnóstico.`,
      };
    }
    if (typeof respuesta !== 'string') {
      return {
        valido: false,
        motivo: 'valor_no_texto',
        detalle: `La respuesta de "${idPregunta}" debe ser un identificador de opción.`,
      };
    }
    if (!opcionesValidas.has(respuesta)) {
      return {
        valido: false,
        motivo: 'opcion_desconocida',
        detalle: `La opción "${respuesta}" no pertenece a la pregunta "${idPregunta}".`,
      };
    }
    respuestas[idPregunta] = respuesta;
  }

  // Cinturon y tirantes: con 12 claves unicas y todas conocidas esto no
  // deberia fallar nunca, pero se comprueba porque el coste es nulo y
  // convierte un error silencioso en uno explicito.
  for (const pregunta of PREGUNTAS) {
    if (!(pregunta.id in respuestas)) {
      return {
        valido: false,
        motivo: 'pregunta_faltante',
        detalle: `Falta responder la pregunta "${pregunta.id}".`,
      };
    }
  }

  return { valido: true, respuestas };
}

// ----------------------------------------------------------------
// Perfil educativo. Vocabulario CERRADO y deliberadamente estrecho.
//
// El perfil es una ORIENTACION EDUCATIVA, nunca un diagnostico. Por eso
// el contrato solo admite tres campos y ningun otro:
//   - estilo_aprendizaje: uno de los cuatro valores permitidos;
//   - nivel_sugerido: entero 1..5, la misma escala de
//     public.ejercicios.nivel_dificultad (0001, check between 1 and 5);
//   - explicacion: texto breve dirigido al estudiante.
//
// Cualquier propiedad adicional se RECHAZA (no se ignora en silencio):
// es la unica forma de garantizar que un modelo no introduzca campos
// clinicos, probabilidades ni etiquetas que este producto no debe emitir.
// ----------------------------------------------------------------
export const NIVEL_SUGERIDO_MINIMO = 1;
export const NIVEL_SUGERIDO_MAXIMO = 5;
export const LONGITUD_MAXIMA_EXPLICACION = 400;

export const CLAVES_PERFIL = ['estilo_aprendizaje', 'nivel_sugerido', 'explicacion'] as const;

export interface PerfilDetectado {
  estilo_aprendizaje: EstiloAprendizaje;
  nivel_sugerido: number;
  explicacion: string;
}

export type MotivoPerfilInvalido =
  | 'no_es_objeto'
  | 'propiedad_no_autorizada'
  | 'estilo_invalido'
  | 'nivel_invalido'
  | 'explicacion_invalida'
  | 'vocabulario_prohibido';

export type ValidacionPerfil =
  | { valido: true; perfil: PerfilDetectado }
  | { valido: false; motivo: MotivoPerfilInvalido; detalle: string };

// Terminos que nunca deben aparecer en una explicacion educativa. No es
// un filtro de seguridad infalible (no pretende serlo): es una barrera
// explicita que impide publicar una explicacion con forma de diagnostico
// clinico aunque el modelo se desvie del prompt. Ante una coincidencia,
// el perfil se rechaza entero -- no se recorta ni se reescribe.
// Los terminos se escriben SIN acentos porque la comparacion se hace
// sobre el texto normalizado (ver normalizarParaComparar): asi
// "psicologica" y "psicológica" se detectan con una sola entrada.
//
// Se exporta para dos usos legitimos y ninguno mas:
//   1. que las pruebas recorran cada raiz e impidan que alguna se pierda
//      en una edicion futura;
//   2. que una prueba compruebe la PARIDAD con la lista equivalente de
//      supabase/migrations/0004_dia3_guardar_perfil_detectado.sql -- las
//      dos capas deben rechazar exactamente lo mismo, porque un usuario
//      autenticado puede invocar la RPC directamente, sin pasar por
//      /api/perfil.
export const RAICES_CLINICAS_PROHIBIDAS = [
  'asperger',
  'autis',
  'tdah',
  'deficit de atencion',
  'dislexi',
  'discapacidad',
  'trastorno',
  'sindrome',
  'patolog',
  'diagnostico clinico',
  'terapia',
  'terapeut',
  'tratamiento',
  'medicac',
  'psicolog',
  'psiquiatr',
  'clinic',
  'coeficiente intelectual',
  'retraso',
] as const;

// Representacion CANONICA usada exclusivamente para comparar. Reduce el
// texto a letras ASCII y digitos: descompone en NFD, pasa a minusculas y
// descarta todo lo demas (marcas combinantes, tildes ya separadas,
// espacios, puntos, guiones y cualquier otro signo).
//
// Cubre tres formas de evasion que una comparacion mas ingenua deja
// pasar, y que importan porque un usuario autenticado puede invocar la
// RPC directamente, sin pasar por /api/perfil:
//   - texto Unicode DESCOMPUESTO: "diagnóstico" se ve identico a
//     "diagnóstico" pero es otra secuencia de caracteres;
//   - separadores intercalados: "T.D.A.H." o "diag-nostico";
//   - espacios repetidos o irregulares: "déficit  de atención".
//
// Ejemplos:
//   "diagnóstico clínico"             -> "diagnosticoclinico"
//   "diagnóstico clínico" -> "diagnosticoclinico"
//   "DIAGNÓSTICO CLÍNICO"             -> "diagnosticoclinico"
//   "T.D.A.H."                        -> "tdah"
//
// IMPORTANTE: esta transformacion se usa SOLO para validar. La
// explicacion que se muestra y se persiste es siempre la original (solo
// recortada de espacios en los extremos): nunca se reescribe ni se
// "limpia" para hacerla aceptable.
//
// PostgreSQL aplica la transformacion equivalente en
// supabase/migrations/0004_dia3_guardar_perfil_detectado.sql:
//   regexp_replace(lower(normalize(texto, NFD)), '[^a-z0-9]', '', 'g')
export function canonizarParaComparar(texto: string): string {
  return texto
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function contieneVocabularioProhibido(texto: string): string | null {
  const canonico = canonizarParaComparar(texto);
  for (const termino of RAICES_CLINICAS_PROHIBIDAS) {
    // La raiz se canoniza con la MISMA funcion: asi las raices de varias
    // palabras ("deficit de atencion") pierden sus espacios igual que el
    // texto y siguen coincidiendo.
    if (canonico.includes(canonizarParaComparar(termino))) return termino;
  }
  return null;
}

export function validarPerfilDetectado(valor: unknown): ValidacionPerfil {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) {
    return { valido: false, motivo: 'no_es_objeto', detalle: 'El perfil debe ser un objeto.' };
  }

  const objeto = valor as Record<string, unknown>;

  // Propiedades adicionales: se rechaza, no se ignora.
  for (const clave of Object.keys(objeto)) {
    if (!(CLAVES_PERFIL as readonly string[]).includes(clave)) {
      return {
        valido: false,
        motivo: 'propiedad_no_autorizada',
        detalle: `El perfil incluye la propiedad no autorizada "${clave}".`,
      };
    }
  }

  const estilo = objeto.estilo_aprendizaje;
  if (typeof estilo !== 'string' || !(ESTILOS_APRENDIZAJE as readonly string[]).includes(estilo)) {
    return {
      valido: false,
      motivo: 'estilo_invalido',
      detalle: 'El estilo de aprendizaje no pertenece al vocabulario permitido.',
    };
  }

  const nivel = objeto.nivel_sugerido;
  if (
    typeof nivel !== 'number' ||
    !Number.isInteger(nivel) ||
    nivel < NIVEL_SUGERIDO_MINIMO ||
    nivel > NIVEL_SUGERIDO_MAXIMO
  ) {
    return {
      valido: false,
      motivo: 'nivel_invalido',
      detalle: `El nivel sugerido debe ser un entero entre ${NIVEL_SUGERIDO_MINIMO} y ${NIVEL_SUGERIDO_MAXIMO}.`,
    };
  }

  const explicacion = objeto.explicacion;
  if (
    typeof explicacion !== 'string' ||
    explicacion.trim().length === 0 ||
    explicacion.length > LONGITUD_MAXIMA_EXPLICACION
  ) {
    return {
      valido: false,
      motivo: 'explicacion_invalida',
      detalle: `La explicación debe ser un texto de 1 a ${LONGITUD_MAXIMA_EXPLICACION} caracteres.`,
    };
  }

  const terminoProhibido = contieneVocabularioProhibido(explicacion);
  if (terminoProhibido) {
    return {
      valido: false,
      motivo: 'vocabulario_prohibido',
      detalle: 'La explicación contiene vocabulario clínico no permitido en este producto.',
    };
  }

  return {
    valido: true,
    perfil: {
      estilo_aprendizaje: estilo as EstiloAprendizaje,
      nivel_sugerido: nivel,
      explicacion: explicacion.trim(),
    },
  };
}

// ----------------------------------------------------------------
// Mensajes de cara al usuario. Igual que en el contrato de auth: el
// detalle tecnico se usa para decidir la categoria, pero lo que se
// muestra es siempre un texto fijo redactado aqui. Nunca se propaga un
// mensaje crudo de Gemini, de Supabase ni de Postgres.
// ----------------------------------------------------------------
export const MENSAJE_ERROR_PERFIL = 'No fue posible generar tu perfil en este momento. Tus respuestas se conservaron: puedes intentarlo de nuevo.';
export const MENSAJE_ERROR_RESPUESTAS = 'Revisa que hayas respondido las 12 preguntas antes de continuar.';
export const MENSAJE_ERROR_SESION = 'Tu sesión no está activa. Inicia sesión de nuevo para continuar.';
