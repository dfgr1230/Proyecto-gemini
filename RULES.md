# RULES.md — Normas de desarrollo

Estas reglas aplican a **todo** cambio de código en este proyecto, sin excepción, salvo que el usuario indique lo contrario explícitamente para un caso puntual.

## 1. Cero regresiones

- Nunca eliminar ni modificar código funcional existente al agregar una característica nueva, a menos que sea estrictamente necesario para esa nueva característica.
- Si una modificación a código existente es necesaria, explicar brevemente por qué antes de hacerla.
- Antes de dar por terminada una tarea, confirmar que las funcionalidades previas (login, diagnóstico, ejercicios, etc.) siguen funcionando igual que antes del cambio.

## 2. Modularidad

- Cada componente, función o ruta nueva va en su propio archivo; no mezclar lógica nueva dentro de archivos que ya cumplen otra función.
- No crear abstracciones ni capas genéricas "por si acaso" — solo lo que la funcionalidad actual requiere.
- Mantener una separación clara entre: interfaz (componentes UI), lógica de datos (Supabase) y lógica de IA (llamadas a Gemini).

## 3. Integración limpia

- Antes de marcar una sección como lista, verificar:
  - Que las importaciones (`import`) sean correctas y no queden referencias rotas.
  - Que la conexión con Supabase (lectura/escritura en las tablas correspondientes) funcione con datos reales, no simulados.
  - Que la llamada a la API de Gemini se ejecute correctamente y maneje errores básicos (ej. respuesta vacía o fallo de red).
- No dar una funcionalidad por completa solo porque el código "se ve bien" — debe probarse el flujo real antes de continuar.

## 4. Estilo general

- Priorizar simplicidad: este proyecto lo mantiene una persona sin experiencia previa de programación: el código debe ser fácil de seguir y explicar en lenguaje simple.
- Evitar dependencias o librerías adicionales que no sean estrictamente necesarias para el alcance definido en `CLAUDE.md`.
- Cualquier decisión que reduzca el alcance del MVP (ver `CLAUDE.md` §6) debe comunicarse al usuario antes de aplicarse.
