// Banco del test de diagnostico inicial (Dia 3).
//
// Contrato impuesto por la base de datos, NO inventado aqui -- ver
// supabase/migrations/0001_dia2_esquema_base.sql, funcion
// es_respuestas_diagnostico_valido(jsonb), usada en el CHECK de
// public.diagnosticos.respuestas:
//   - "respuestas" debe ser un objeto JSON (no arreglo ni escalar);
//   - entre 10 y 15 claves -- aqui son exactamente 12;
//   - ninguna clave vacia ni solo espacios;
//   - ningun valor null, objeto ni arreglo (solo string, numero o booleano);
//   - si el valor es string, no puede estar vacio ni ser solo espacios.
// Por eso cada respuesta viaja como el identificador de opcion ('A'..'D'),
// que es un string corto y estable.
//
// Alcance deliberado de las preguntas (CLAUDE.md seccion 1 y 6):
// preferencias y necesidades EDUCATIVAS, para inferir un estilo de
// aprendizaje y un nivel inicial sugerido. No se pregunta ni se infiere
// ninguna condicion clinica, ni se solicita nombre, correo, documento,
// edad exacta ni informacion familiar.

export const ESTILOS_APRENDIZAJE = ['visual', 'auditivo', 'lectoescritor', 'kinestesico'] as const;
export type EstiloAprendizaje = (typeof ESTILOS_APRENDIZAJE)[number];

export interface OpcionPregunta {
  id: string;
  texto: string;
}

export interface Pregunta {
  id: string;
  enunciado: string;
  opciones: readonly OpcionPregunta[];
}

// Exactamente 12 preguntas. Las ocho primeras exploran COMO prefiere
// aprender el estudiante; las cuatro ultimas, que tanto apoyo necesita
// (senal para el nivel inicial sugerido). Ninguna pregunta pide datos
// personales ni usa vocabulario medico.
export const PREGUNTAS: readonly Pregunta[] = [
  {
    id: 'p1',
    enunciado: 'Cuando te explican algo nuevo, ¿qué te ayuda más a entenderlo?',
    opciones: [
      { id: 'A', texto: 'Ver un dibujo, esquema o video' },
      { id: 'B', texto: 'Escuchar la explicación en voz alta' },
      { id: 'C', texto: 'Leerlo escrito con mis palabras' },
      { id: 'D', texto: 'Probarlo yo mismo con un ejemplo' },
    ],
  },
  {
    id: 'p2',
    enunciado: 'Para recordar algo importante, normalmente prefieres…',
    opciones: [
      { id: 'A', texto: 'Imaginarlo como una imagen' },
      { id: 'B', texto: 'Repetirlo en voz alta' },
      { id: 'C', texto: 'Escribirlo en una lista o resumen' },
      { id: 'D', texto: 'Asociarlo con algo que hiciste' },
    ],
  },
  {
    id: 'p3',
    enunciado: 'Si un problema de matemáticas te cuesta, ¿qué haces primero?',
    opciones: [
      { id: 'A', texto: 'Dibujo el problema para verlo' },
      { id: 'B', texto: 'Me lo explico hablando conmigo mismo' },
      { id: 'C', texto: 'Vuelvo a leer el enunciado con calma' },
      { id: 'D', texto: 'Pruebo con números hasta que encaje' },
    ],
  },
  {
    id: 'p4',
    enunciado: 'En una clase, ¿qué actividad disfrutas más?',
    opciones: [
      { id: 'A', texto: 'Ver mapas, gráficos o presentaciones' },
      { id: 'B', texto: 'Conversar y comentar en grupo' },
      { id: 'C', texto: 'Leer un texto y responder preguntas' },
      { id: 'D', texto: 'Hacer un experimento o construir algo' },
    ],
  },
  {
    id: 'p5',
    enunciado: 'Cuando lees una historia, ¿qué se te queda más?',
    opciones: [
      { id: 'A', texto: 'Las escenas que me imagino' },
      { id: 'B', texto: 'Cómo suenan los diálogos' },
      { id: 'C', texto: 'Las palabras y frases exactas' },
      { id: 'D', texto: 'Lo que hacen los personajes' },
    ],
  },
  {
    id: 'p6',
    enunciado: 'Si tuvieras que enseñarle algo a un compañero, ¿cómo lo harías?',
    opciones: [
      { id: 'A', texto: 'Le haría un dibujo o esquema' },
      { id: 'B', texto: 'Se lo explicaría hablando' },
      { id: 'C', texto: 'Le escribiría los pasos' },
      { id: 'D', texto: 'Lo haríamos juntos paso a paso' },
    ],
  },
  {
    id: 'p7',
    enunciado: '¿Qué tipo de instrucciones sigues con más facilidad?',
    opciones: [
      { id: 'A', texto: 'Un video o una imagen con los pasos' },
      { id: 'B', texto: 'Que alguien me las diga' },
      { id: 'C', texto: 'Una lista escrita' },
      { id: 'D', texto: 'Que me muestren haciéndolo' },
    ],
  },
  {
    id: 'p8',
    enunciado: 'Cuando estudias solo, ¿qué haces con más frecuencia?',
    opciones: [
      { id: 'A', texto: 'Subrayo con colores y hago mapas' },
      { id: 'B', texto: 'Leo en voz alta o me grabo' },
      { id: 'C', texto: 'Hago resúmenes escritos' },
      { id: 'D', texto: 'Practico con ejercicios' },
    ],
  },
  {
    id: 'p9',
    enunciado: 'En matemáticas, ¿cómo te sientes ahora mismo?',
    opciones: [
      { id: 'A', texto: 'Necesito ayuda desde lo más básico' },
      { id: 'B', texto: 'Entiendo lo básico, me cuesta lo demás' },
      { id: 'C', texto: 'Me va bien en la mayoría de temas' },
      { id: 'D', texto: 'Me resulta fácil y quiero más reto' },
    ],
  },
  {
    id: 'p10',
    enunciado: 'En lectura y escritura, ¿cómo te sientes ahora mismo?',
    opciones: [
      { id: 'A', texto: 'Necesito ayuda desde lo más básico' },
      { id: 'B', texto: 'Entiendo lo básico, me cuesta lo demás' },
      { id: 'C', texto: 'Me va bien en la mayoría de temas' },
      { id: 'D', texto: 'Me resulta fácil y quiero más reto' },
    ],
  },
  {
    id: 'p11',
    enunciado: 'Cuando un ejercicio te sale mal, ¿qué prefieres?',
    opciones: [
      { id: 'A', texto: 'Que me lo expliquen otra vez desde el principio' },
      { id: 'B', texto: 'Una pista y volver a intentarlo' },
      { id: 'C', texto: 'Ver la solución y compararla con la mía' },
      { id: 'D', texto: 'Intentarlo de nuevo sin ayuda' },
    ],
  },
  {
    id: 'p12',
    enunciado: '¿Cuánto tiempo sueles mantener la concentración cómodamente?',
    opciones: [
      { id: 'A', texto: 'Pocos minutos, prefiero tareas muy cortas' },
      { id: 'B', texto: 'Alrededor de diez minutos' },
      { id: 'C', texto: 'Alrededor de media hora' },
      { id: 'D', texto: 'Bastante tiempo si el tema me interesa' },
    ],
  },
];

export const CANTIDAD_PREGUNTAS = PREGUNTAS.length;
