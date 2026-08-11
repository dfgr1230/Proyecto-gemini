// Contrato del ANALISIS ADAPTATIVO (Dia 3 -- ciclo completo).
//
// Este es el contrato de la decision educativa que toma Gemini despues de
// cada respuesta del estudiante. Es un contrato DISTINTO del perfil
// inicial de src/lib/diagnostico/contrato.ts y por eso vive en su propio
// modulo (RULES.md seccion 2):
//
//   - el perfil inicial responde "como aprende esta persona" a partir de
//     un cuestionario de preferencias, una sola vez;
//   - el analisis adaptativo responde "que conviene hacer ahora" a partir
//     de evidencia real de desempeno, una vez por interaccion.
//
// Igual que el resto de contratos del proyecto: funciones puras, sin
// React, sin DOM, sin Supabase y sin red, para poder probarse con datos
// locales.
//
// PRINCIPIO CENTRAL: una respuesta incompleta o invalida de Gemini NO es
// un analisis. No se completa con valores por defecto, no se recorta y no
// se "arregla" -- se rechaza entera. Persistir un analisis a medias seria
// presentar como decision pedagogica algo que el modelo no dijo.

// Imports con extension ".ts" a proposito: el mismo modulo debe cargarse
// desde Next y desde "node --test" (ver src/lib/diagnostico/contrato.ts).
import {
  NIVEL_SUGERIDO_MINIMO,
  NIVEL_SUGERIDO_MAXIMO,
  contieneVocabularioProhibido,
} from '../diagnostico/contrato.ts';

// La escala de dificultad es la MISMA de public.ejercicios.nivel_dificultad
// (check between 1 and 5 en 0001) y la misma del perfil inicial. Se
// reexporta desde el contrato del diagnostico en vez de repetir los
// numeros, para que no puedan desincronizarse.
export const NIVEL_MINIMO = NIVEL_SUGERIDO_MINIMO;
export const NIVEL_MAXIMO = NIVEL_SUGERIDO_MAXIMO;

// Materias admitidas: identicas al CHECK de public.ejercicios.materia en
// 0001. Si Gemini propusiera otra, el analisis se rechaza en vez de
// guardarse un valor que la base de datos jamas podria satisfacer.
export const MATERIAS = ['matematicas', 'lenguaje'] as const;
export type Materia = (typeof MATERIAS)[number];

// Grado de confianza. Vocabulario CERRADO y cualitativo a proposito: se
// descarto un porcentaje numerico porque una cifra como "87 %" aparenta
// una precision que un modelo de lenguaje no puede sustentar sobre uno o
// dos intentos, y el jurado (y el estudiante) la leerian como una medida
// real.
export const NIVELES_CONFIANZA = ['baja', 'media', 'alta'] as const;
export type NivelConfianza = (typeof NIVELES_CONFIANZA)[number];

export const MAXIMO_ELEMENTOS_LISTA = 3;
export const LONGITUD_MAXIMA_ELEMENTO = 120;
export const LONGITUD_MAXIMA_FRASE = 240;
export const LONGITUD_MAXIMA_JUSTIFICACION = 400;

// Las nueve claves cubren, una a una, los ocho puntos exigidos al ciclo:
//   fortalezas observadas                -> fortalezas
//   dificultades educativas observadas   -> dificultades
//   habilidad prioritaria                -> habilidad_prioritaria
//   nivel o dificultad recomendada       -> nivel_recomendado
//   apoyo pedagogico recomendado         -> apoyo_pedagogico
//   siguiente actividad                  -> siguiente_actividad_materia
//                                         + siguiente_actividad_enfoque
//                                         (+ nivel_recomendado)
//   justificacion basada en evidencias   -> justificacion
//   grado de confianza                   -> confianza
//
// La estructura es PLANA a proposito: la validacion equivalente dentro de
// PostgreSQL (paso manual pendiente, ver docs/) recorre claves de primer
// nivel; anidar objetos obligaria a una funcion SQL recursiva sin aportar
// nada al producto.
export const CLAVES_ANALISIS = [
  'fortalezas',
  'dificultades',
  'habilidad_prioritaria',
  'nivel_recomendado',
  'apoyo_pedagogico',
  'siguiente_actividad_materia',
  'siguiente_actividad_enfoque',
  'justificacion',
  'confianza',
] as const;

export interface AnalisisAdaptativo {
  fortalezas: string[];
  dificultades: string[];
  habilidad_prioritaria: string;
  nivel_recomendado: number;
  apoyo_pedagogico: string;
  siguiente_actividad_materia: Materia;
  siguiente_actividad_enfoque: string;
  justificacion: string;
  confianza: NivelConfianza;
}

export type MotivoAnalisisInvalido =
  | 'no_es_objeto'
  | 'propiedad_no_autorizada'
  | 'clave_faltante'
  | 'lista_invalida'
  | 'texto_invalido'
  | 'nivel_invalido'
  | 'materia_invalida'
  | 'confianza_invalida'
  | 'vocabulario_prohibido';

export type ValidacionAnalisis =
  | { valido: true; analisis: AnalisisAdaptativo }
  | { valido: false; motivo: MotivoAnalisisInvalido; detalle: string };

// Texto libre: string, no vacio tras recortar, dentro del limite. Se
// devuelve recortado; nunca se reescribe el contenido.
function validarTexto(
  valor: unknown,
  clave: string,
  maximo: number
): { ok: true; texto: string } | { ok: false; detalle: string } {
  if (typeof valor !== 'string') {
    return { ok: false, detalle: `"${clave}" debe ser texto.` };
  }
  const recortado = valor.trim();
  if (recortado.length === 0) {
    return { ok: false, detalle: `"${clave}" no puede estar vacío.` };
  }
  if (valor.length > maximo) {
    return { ok: false, detalle: `"${clave}" supera los ${maximo} caracteres.` };
  }
  return { ok: true, texto: recortado };
}

function validarLista(
  valor: unknown,
  clave: string
): { ok: true; lista: string[] } | { ok: false; detalle: string } {
  if (!Array.isArray(valor)) {
    return { ok: false, detalle: `"${clave}" debe ser una lista.` };
  }
  // Se exige al menos un elemento: una lista vacia es exactamente el caso
  // "respuesta incompleta" que no puede tratarse como analisis valido.
  if (valor.length === 0 || valor.length > MAXIMO_ELEMENTOS_LISTA) {
    return {
      ok: false,
      detalle: `"${clave}" debe tener entre 1 y ${MAXIMO_ELEMENTOS_LISTA} elementos.`,
    };
  }
  const lista: string[] = [];
  for (const elemento of valor) {
    const r = validarTexto(elemento, clave, LONGITUD_MAXIMA_ELEMENTO);
    if (!r.ok) return { ok: false, detalle: r.detalle };
    lista.push(r.texto);
  }
  return { ok: true, lista };
}

// Validacion estricta y completa del JSON devuelto por Gemini.
//
// Orden deliberado: primero se comprueba que no sobre ninguna clave,
// luego que no falte ninguna, luego los tipos y rangos, y al final el
// vocabulario clinico sobre TODOS los textos juntos. Asi un analisis con
// una etiqueta clinica escondida en, por ejemplo, "apoyo_pedagogico"
// (y no en "justificacion") tambien se rechaza.
export function validarAnalisisAdaptativo(valor: unknown): ValidacionAnalisis {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) {
    return { valido: false, motivo: 'no_es_objeto', detalle: 'El análisis debe ser un objeto.' };
  }

  const objeto = valor as Record<string, unknown>;
  const permitidas = CLAVES_ANALISIS as readonly string[];

  for (const clave of Object.keys(objeto)) {
    if (!permitidas.includes(clave)) {
      return {
        valido: false,
        motivo: 'propiedad_no_autorizada',
        detalle: `El análisis incluye la propiedad no autorizada "${clave}".`,
      };
    }
  }

  for (const clave of permitidas) {
    if (!(clave in objeto)) {
      return {
        valido: false,
        motivo: 'clave_faltante',
        detalle: `Al análisis le falta la propiedad obligatoria "${clave}".`,
      };
    }
  }

  const fortalezas = validarLista(objeto.fortalezas, 'fortalezas');
  if (!fortalezas.ok) {
    return { valido: false, motivo: 'lista_invalida', detalle: fortalezas.detalle };
  }

  const dificultades = validarLista(objeto.dificultades, 'dificultades');
  if (!dificultades.ok) {
    return { valido: false, motivo: 'lista_invalida', detalle: dificultades.detalle };
  }

  const habilidad = validarTexto(
    objeto.habilidad_prioritaria,
    'habilidad_prioritaria',
    LONGITUD_MAXIMA_ELEMENTO
  );
  if (!habilidad.ok) {
    return { valido: false, motivo: 'texto_invalido', detalle: habilidad.detalle };
  }

  const nivel = objeto.nivel_recomendado;
  if (
    typeof nivel !== 'number' ||
    !Number.isInteger(nivel) ||
    nivel < NIVEL_MINIMO ||
    nivel > NIVEL_MAXIMO
  ) {
    return {
      valido: false,
      motivo: 'nivel_invalido',
      detalle: `"nivel_recomendado" debe ser un entero entre ${NIVEL_MINIMO} y ${NIVEL_MAXIMO}.`,
    };
  }

  const apoyo = validarTexto(objeto.apoyo_pedagogico, 'apoyo_pedagogico', LONGITUD_MAXIMA_FRASE);
  if (!apoyo.ok) {
    return { valido: false, motivo: 'texto_invalido', detalle: apoyo.detalle };
  }

  const materia = objeto.siguiente_actividad_materia;
  if (typeof materia !== 'string' || !(MATERIAS as readonly string[]).includes(materia)) {
    return {
      valido: false,
      motivo: 'materia_invalida',
      detalle: `"siguiente_actividad_materia" debe ser una de: ${MATERIAS.join(', ')}.`,
    };
  }

  const enfoque = validarTexto(
    objeto.siguiente_actividad_enfoque,
    'siguiente_actividad_enfoque',
    LONGITUD_MAXIMA_FRASE
  );
  if (!enfoque.ok) {
    return { valido: false, motivo: 'texto_invalido', detalle: enfoque.detalle };
  }

  const justificacion = validarTexto(
    objeto.justificacion,
    'justificacion',
    LONGITUD_MAXIMA_JUSTIFICACION
  );
  if (!justificacion.ok) {
    return { valido: false, motivo: 'texto_invalido', detalle: justificacion.detalle };
  }

  const confianza = objeto.confianza;
  if (
    typeof confianza !== 'string' ||
    !(NIVELES_CONFIANZA as readonly string[]).includes(confianza)
  ) {
    return {
      valido: false,
      motivo: 'confianza_invalida',
      detalle: `"confianza" debe ser una de: ${NIVELES_CONFIANZA.join(', ')}.`,
    };
  }

  // Barrera clinica sobre TODOS los textos del analisis, con la misma
  // lista y la misma normalizacion canonica que ya aplica el perfil
  // inicial (src/lib/diagnostico/contrato.ts) y que PostgreSQL replica en
  // 0004. Se reutiliza la funcion existente en vez de duplicar la lista:
  // dos listas que puedan divergir serian peor que una sola.
  const textos = [
    ...fortalezas.lista,
    ...dificultades.lista,
    habilidad.texto,
    apoyo.texto,
    enfoque.texto,
    justificacion.texto,
  ];
  for (const texto of textos) {
    if (contieneVocabularioProhibido(texto)) {
      return {
        valido: false,
        motivo: 'vocabulario_prohibido',
        detalle: 'El análisis contiene vocabulario clínico no permitido en este producto.',
      };
    }
  }

  return {
    valido: true,
    analisis: {
      fortalezas: fortalezas.lista,
      dificultades: dificultades.lista,
      habilidad_prioritaria: habilidad.texto,
      nivel_recomendado: nivel,
      apoyo_pedagogico: apoyo.texto,
      siguiente_actividad_materia: materia as Materia,
      siguiente_actividad_enfoque: enfoque.texto,
      justificacion: justificacion.texto,
      confianza: confianza as NivelConfianza,
    },
  };
}

// ----------------------------------------------------------------
// Mensajes de cara al usuario. Mismo criterio que el resto del proyecto:
// texto fijo redactado aqui, nunca un mensaje crudo de Gemini, Supabase o
// Postgres.
//
// El primero es deliberadamente explicito sobre lo que SI ocurrio: la
// respuesta quedo registrada. Decir solo "hubo un error" haria pensar que
// se perdio el intento y empujaria a repetirlo.
// ----------------------------------------------------------------
export const MENSAJE_ANALISIS_NO_DISPONIBLE =
  'Tu respuesta quedó registrada, pero el análisis adaptativo no está disponible en este momento. Puedes volver a pedirlo en unos segundos.';
export const MENSAJE_ANALISIS_NO_CONSERVADO =
  'El análisis se generó correctamente, pero todavía no se pudo conservar en tu historial.';
export const MENSAJE_SIN_PERFIL =
  'Necesitas completar el diagnóstico inicial antes de comenzar el ciclo adaptativo.';
