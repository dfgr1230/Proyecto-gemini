// Contrato de la actividad adaptativa (Sprint B).
//
// Mismo patron que diagnostico/contrato.ts: funciones puras, sin React,
// sin DOM y sin tocar Supabase -- todo lo que decide que se muestra y que
// se recomienda vive aqui y se prueba con datos locales.
//
// Reparto de responsabilidades, deliberado:
//   - QUE ejercicio se presenta lo decide este modulo, a partir del
//     nivel que Gemini sugirio en el perfil;
//   - SI la respuesta es correcta lo decide la base de datos dentro de
//     registrar_intento(), nunca el navegador;
//   - QUE nivel se recomienda despues es una regla determinista sobre el
//     nivel del ejercicio y el resultado que devolvio la RPC.

import { NIVEL_SUGERIDO_MINIMO, NIVEL_SUGERIDO_MAXIMO } from '../diagnostico/contrato.ts';
import type { EstiloAprendizaje } from '../diagnostico/preguntas.ts';

export const NIVEL_MINIMO = NIVEL_SUGERIDO_MINIMO;
export const NIVEL_MAXIMO = NIVEL_SUGERIDO_MAXIMO;

// Forma de ejercicios.contenido acordada en 0002. El esquema solo exige
// "objeto JSON", asi que la estructura se valida aqui antes de dibujar
// nada: una fila malformada debe producir un mensaje claro, no una
// pantalla rota.
export interface ContenidoEjercicio {
  tipo: string;
  enunciado: string;
  opciones: Record<string, string>;
}

export interface EjercicioDisponible {
  id: string;
  materia: string;
  nivel_dificultad: number;
  contenido: ContenidoEjercicio;
}

export const TIPO_OPCION_MULTIPLE = 'opcion_multiple';

// Claves que jamas deben viajar dentro de "contenido". La respuesta
// oficial vive en ejercicios_respuestas, tabla con RLS activo y sin
// ninguna policy (inaccesible para anon y authenticated). Esta
// comprobacion es defensa en profundidad: si alguien sembrara un
// ejercicio con la respuesta incrustada en el contenido publico, el
// ejercicio se descarta en vez de filtrarla.
const CLAVES_PROHIBIDAS_EN_CONTENIDO = ['respuesta_correcta', 'respuesta', 'correcta', 'solucion'];

export type ValidacionEjercicio =
  | { valido: true; ejercicio: EjercicioDisponible }
  | { valido: false; motivo: string };

export function validarEjercicio(crudo: unknown): ValidacionEjercicio {
  if (crudo === null || typeof crudo !== 'object' || Array.isArray(crudo)) {
    return { valido: false, motivo: 'no_es_objeto' };
  }
  const fila = crudo as Record<string, unknown>;

  if (typeof fila.id !== 'string' || fila.id.length === 0) {
    return { valido: false, motivo: 'id_invalido' };
  }
  if (typeof fila.materia !== 'string' || fila.materia.length === 0) {
    return { valido: false, motivo: 'materia_invalida' };
  }
  const nivel = fila.nivel_dificultad;
  if (
    typeof nivel !== 'number' ||
    !Number.isInteger(nivel) ||
    nivel < NIVEL_MINIMO ||
    nivel > NIVEL_MAXIMO
  ) {
    return { valido: false, motivo: 'nivel_invalido' };
  }

  const contenido = fila.contenido;
  if (contenido === null || typeof contenido !== 'object' || Array.isArray(contenido)) {
    return { valido: false, motivo: 'contenido_invalido' };
  }
  const c = contenido as Record<string, unknown>;

  for (const clave of Object.keys(c)) {
    if (CLAVES_PROHIBIDAS_EN_CONTENIDO.includes(clave.toLowerCase())) {
      return { valido: false, motivo: 'contenido_expone_respuesta' };
    }
  }

  if (c.tipo !== TIPO_OPCION_MULTIPLE) {
    return { valido: false, motivo: 'tipo_no_soportado' };
  }
  if (typeof c.enunciado !== 'string' || c.enunciado.trim().length === 0) {
    return { valido: false, motivo: 'enunciado_invalido' };
  }

  const opciones = c.opciones;
  if (opciones === null || typeof opciones !== 'object' || Array.isArray(opciones)) {
    return { valido: false, motivo: 'opciones_invalidas' };
  }
  const entradas = Object.entries(opciones as Record<string, unknown>);
  if (entradas.length < 2) {
    return { valido: false, motivo: 'opciones_insuficientes' };
  }
  const limpias: Record<string, string> = {};
  for (const [id, texto] of entradas) {
    if (id.trim().length === 0) return { valido: false, motivo: 'opciones_invalidas' };
    if (typeof texto !== 'string' || texto.trim().length === 0) {
      return { valido: false, motivo: 'opciones_invalidas' };
    }
    limpias[id] = texto;
  }

  return {
    valido: true,
    ejercicio: {
      id: fila.id,
      materia: fila.materia,
      nivel_dificultad: nivel,
      contenido: { tipo: c.tipo, enunciado: c.enunciado.trim(), opciones: limpias },
    },
  };
}

export type SeleccionEjercicio =
  | { estado: 'elegido'; ejercicio: EjercicioDisponible; exacto: boolean }
  | { estado: 'sin_ejercicios' };

// Elige el ejercicio cuyo nivel esta mas cerca del que Gemini sugirio.
//
// Desempate hacia ABAJO a proposito: ante dos niveles igual de lejanos
// (por ejemplo 2 y 4 para un nivel sugerido 3), empezar por el mas facil
// permite avanzar despues; empezar por el mas dificil puede frenar en
// seco a quien acaba de llegar. Segundo desempate por id, para que la
// seleccion sea totalmente determinista y reproducible en una demo.
export function seleccionarEjercicio(
  ejercicios: readonly EjercicioDisponible[],
  nivelSugerido: number
): SeleccionEjercicio {
  if (ejercicios.length === 0) return { estado: 'sin_ejercicios' };

  const ordenados = [...ejercicios].sort((a, b) => {
    const da = Math.abs(a.nivel_dificultad - nivelSugerido);
    const db = Math.abs(b.nivel_dificultad - nivelSugerido);
    if (da !== db) return da - db;
    if (a.nivel_dificultad !== b.nivel_dificultad) return a.nivel_dificultad - b.nivel_dificultad;
    return a.id.localeCompare(b.id);
  });

  const elegido = ordenados[0];
  return {
    estado: 'elegido',
    ejercicio: elegido,
    exacto: elegido.nivel_dificultad === nivelSugerido,
  };
}

// Regla adaptativa visible. Determinista y acotada a [1, 5]: en un
// limite, el nivel se mantiene en vez de salirse del rango.
export function calcularNivelSiguiente(nivelEjercicio: number, correcto: boolean): number {
  const propuesto = correcto ? nivelEjercicio + 1 : nivelEjercicio - 1;
  return Math.min(NIVEL_MAXIMO, Math.max(NIVEL_MINIMO, propuesto));
}

export interface IntentoRegistrado {
  id: string;
  ejercicio_id: string;
  correcto: boolean;
  fecha: string;
  // Opcional y añadido en el ciclo adaptativo (Dia 3): la columna existe
  // en public.intentos desde 0001, pero /actividad no la pedia porque no
  // la necesitaba. El ciclo si la usa como evidencia, y declararla
  // opcional evita tocar las consultas que no la seleccionan.
  tiempo_respuesta?: number | null;
  // Igual que la anterior: existe en public.intentos desde 0001 y el
  // ciclo adaptativo la necesita para detectar reintentos identicos.
  respuesta_dada?: string | null;
}

export interface Progreso {
  completadas: number;
  aciertos: number;
  ultimoCorrecto: boolean | null;
  nivelUltimoEjercicio: number | null;
  nivelInicialSugerido: number;
  nivelProximoRecomendado: number;
  seMantiene: boolean;
}

// Reconstruye el progreso a partir de lo persistido. No hay ninguna
// columna nueva: el nivel del ejercicio realizado se obtiene cruzando
// intentos.ejercicio_id con el banco, de modo que la recomendacion
// sobrevive a una recarga sin almacenar nada derivado.
export function resumirProgreso(
  intentos: readonly IntentoRegistrado[],
  ejercicios: readonly EjercicioDisponible[],
  nivelInicialSugerido: number
): Progreso {
  const nivelPorId = new Map(ejercicios.map((e) => [e.id, e.nivel_dificultad]));

  const ordenados = [...intentos].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const ultimo = ordenados.length > 0 ? ordenados[ordenados.length - 1] : null;

  const nivelUltimo = ultimo ? (nivelPorId.get(ultimo.ejercicio_id) ?? null) : null;

  // Sin intento, o con un intento cuyo ejercicio ya no esta en el banco,
  // la unica recomendacion honesta es la que dio el perfil.
  const nivelProximo =
    ultimo !== null && nivelUltimo !== null
      ? calcularNivelSiguiente(nivelUltimo, ultimo.correcto)
      : nivelInicialSugerido;

  return {
    completadas: ordenados.length,
    aciertos: ordenados.filter((i) => i.correcto).length,
    ultimoCorrecto: ultimo ? ultimo.correcto : null,
    nivelUltimoEjercicio: nivelUltimo,
    nivelInicialSugerido,
    nivelProximoRecomendado: nivelProximo,
    seMantiene: nivelUltimo !== null && nivelProximo === nivelUltimo,
  };
}

// Interpretacion del resultado de registrar_intento(). Mismo criterio
// que interpretarResultadoPersistencia: no se declara exito sin
// evidencia positiva de la fila creada. El "correcto" SIEMPRE sale de
// aqui -- es decir, de la base de datos -- nunca de una comparacion
// hecha en el navegador, que no tiene acceso a la respuesta oficial.
export type ResultadoIntento =
  | { estado: 'registrado'; correcto: boolean }
  | { estado: 'no_registrado' };

export function interpretarResultadoIntento(respuesta: {
  data: unknown;
  error: unknown;
}): ResultadoIntento {
  if (respuesta.error) return { estado: 'no_registrado' };

  const filas = Array.isArray(respuesta.data) ? respuesta.data : [];
  if (filas.length === 0) return { estado: 'no_registrado' };

  const primera = filas[0];
  if (primera === null || typeof primera !== 'object') return { estado: 'no_registrado' };

  const correcto = (primera as { es_correcto?: unknown }).es_correcto;
  if (typeof correcto !== 'boolean') return { estado: 'no_registrado' };

  return { estado: 'registrado', correcto };
}

// Frase de orientacion segun el estilo detectado. Es la unica adaptacion
// por estilo: cambia como se presenta la consigna, no que se pregunta ni
// como se corrige. Construir modulos pedagogicos distintos por estilo
// seria prometer mas de lo que este MVP hace.
const ORIENTACION_POR_ESTILO: Record<EstiloAprendizaje, string> = {
  visual: 'Lee el enunciado y visualiza la operación antes de elegir.',
  auditivo: 'Lee el enunciado en voz alta antes de elegir.',
  lectoescritor: 'Lee el enunciado con calma y repásalo antes de elegir.',
  kinestesico: 'Resuélvelo a tu manera —con los dedos o en papel— y luego elige.',
};

export function orientacionParaEstilo(estilo: EstiloAprendizaje): string {
  return ORIENTACION_POR_ESTILO[estilo];
}

export const MENSAJE_SIN_EJERCICIOS =
  'Todavía no hay actividades disponibles para tu nivel. Vuelve a intentarlo más tarde.';
export const MENSAJE_ERROR_ACTIVIDAD =
  'No fue posible cargar la actividad en este momento. Vuelve a intentarlo en unos segundos.';
export const MENSAJE_ERROR_INTENTO =
  'No fue posible registrar tu respuesta. Vuelve a intentarlo en unos segundos.';
