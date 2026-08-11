// Seleccion de la SIGUIENTE actividad a partir de la recomendacion de
// Gemini.
//
// Diferencia deliberada con seleccionarEjercicio() de
// src/lib/actividad/contrato.ts, que se conserva intacto:
//
//   - aquella elige la PRIMERA actividad a partir del nivel del perfil
//     inicial, y no conoce el historial;
//   - esta elige la SIGUIENTE a partir de la decision del ciclo
//     (materia + nivel recomendados por Gemini) y descarta lo ya
//     respondido, para que la segunda iteracion no repita la primera.
//
// Reparto de responsabilidades, que la interfaz debe reflejar sin
// adornos: Gemini decide QUE materia y QUE nivel convienen ahora; este
// modulo se limita a encontrar en el banco la actividad que mejor encaja
// con esa decision. No inventa ejercicios ni reinterpreta la
// recomendacion.

import type { EjercicioDisponible, IntentoRegistrado } from '../actividad/contrato.ts';
import type { AnalisisAdaptativo } from './contrato.ts';

export type SeleccionSiguiente =
  | {
      estado: 'elegida';
      ejercicio: EjercicioDisponible;
      // Que tan bien encaja con lo que Gemini pidio. Se expone para que
      // la interfaz pueda ser honesta cuando el banco no tiene lo ideal,
      // en vez de presentar una aproximacion como si fuera exacta.
      coincide_materia: boolean;
      coincide_nivel: boolean;
    }
  // El banco se agoto: todo lo disponible ya fue respondido.
  | { estado: 'sin_pendientes' }
  | { estado: 'sin_ejercicios' };

export function seleccionarSiguienteActividad(
  ejercicios: readonly EjercicioDisponible[],
  analisis: AnalisisAdaptativo,
  intentos: readonly IntentoRegistrado[]
): SeleccionSiguiente {
  if (ejercicios.length === 0) return { estado: 'sin_ejercicios' };

  const respondidos = new Set(intentos.map((i) => i.ejercicio_id));
  const pendientes = ejercicios.filter((e) => !respondidos.has(e.id));

  if (pendientes.length === 0) return { estado: 'sin_pendientes' };

  const ordenados = [...pendientes].sort((a, b) => {
    // 1. El nivel mas cercano al recomendado manda sobre la materia.
    //
    //    Es una decision deliberada y con coste: si Gemini pide lenguaje
    //    y el banco no tiene lenguaje en ese nivel, se sirve otra materia
    //    en el nivel adecuado. Se prefiere asi porque el desajuste de
    //    dificultad es justo lo que el ciclo existe para corregir --
    //    poner un nivel 3 a quien acaba de fallar un nivel 2 deshace el
    //    trabajo del analisis, mientras que cambiar de materia solo lo
    //    aplaza. La interfaz declara ambas coincidencias, de modo que
    //    nunca se presenta una aproximacion como si fuera exacta.
    const da = Math.abs(a.nivel_dificultad - analisis.nivel_recomendado);
    const db = Math.abs(b.nivel_dificultad - analisis.nivel_recomendado);
    if (da !== db) return da - db;

    // 2. A igual distancia, la materia que pidio Gemini.
    const ma = a.materia === analisis.siguiente_actividad_materia ? 0 : 1;
    const mb = b.materia === analisis.siguiente_actividad_materia ? 0 : 1;
    if (ma !== mb) return ma - mb;

    // 3. Empate de distancia: se prefiere el nivel MAS BAJO, por el mismo
    //    motivo que en la seleccion inicial -- empezar por lo mas facil
    //    permite avanzar; empezar por lo mas dificil puede frenar en seco.
    if (a.nivel_dificultad !== b.nivel_dificultad) {
      return a.nivel_dificultad - b.nivel_dificultad;
    }

    // 4. Ultimo desempate por id, para que una demo sea reproducible.
    return a.id.localeCompare(b.id);
  });

  const elegido = ordenados[0];
  return {
    estado: 'elegida',
    ejercicio: elegido,
    coincide_materia: elegido.materia === analisis.siguiente_actividad_materia,
    coincide_nivel: elegido.nivel_dificultad === analisis.nivel_recomendado,
  };
}

export const MENSAJE_SIN_PENDIENTES =
  'Ya completaste todas las actividades disponibles del banco. Pronto habrá más contenido para tu nivel.';
