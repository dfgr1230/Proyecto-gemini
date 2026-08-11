// Fabrica compartida por las pruebas del ciclo adaptativo.
//
// Vive en un archivo aparte -- y con un nombre que NO termina en
// ".test.mjs" -- a proposito: si esta fabrica estuviera dentro de un
// archivo de pruebas, importarla desde otro registraria dos veces la
// misma bateria y los recuentos dejarian de ser fiables.
//
// Devuelve el analisis MINIMO que el contrato acepta. Cada prueba
// sobreescribe solo el campo que quiere poner a prueba, de modo que un
// fallo senala exactamente ese campo y no un descuido del ejemplo.

export function analisisValido(cambios = {}) {
  return {
    fortalezas: ['Resuelves sumas de una cifra sin dudar'],
    dificultades: ['Te cuesta sostener la atención en enunciados largos'],
    habilidad_prioritaria: 'Sumas con reagrupación',
    nivel_recomendado: 2,
    apoyo_pedagogico: 'Divide el enunciado en dos partes y resuelve una a la vez.',
    siguiente_actividad_materia: 'matematicas',
    siguiente_actividad_enfoque: 'Una suma de dos cifras con apoyo visual.',
    justificacion:
      'Acertaste el ejercicio de matemáticas de nivel 1, así que conviene subir a nivel 2.',
    confianza: 'baja',
    ...cambios,
  };
}
