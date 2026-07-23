# CLAUDE.md — Plataforma de Aprendizaje Adaptativo (Build with Gemini XPRIZE)

## 1. Resumen del proyecto

Plataforma web enfocada en la categoría **"Educación y Potencial Humano"** del hackathon **Build with Gemini XPRIZE**.

Flujo funcional:
1. El usuario se registra y realiza un **test de diagnóstico inicial** (identifica necesidades de aprendizaje y perfiles, ej. estilo de aprendizaje, indicadores de perfil Asperger).
2. A partir del diagnóstico, la plataforma genera un **perfil de usuario**.
3. El usuario recibe **ejercicios adaptativos de matemáticas y lenguaje**, cuya dificultad se ajusta **en tiempo real** según sus respuestas, usando la **API de Google Gemini** como motor de razonamiento adaptativo.

Objetivo del hackathon: construir un MVP funcional, desplegable en menos de una semana, con operación real de IA y usuarios de prueba reales.

---

## 2. Arquitectura técnica

| Capa | Tecnología | Rol |
|---|---|---|
| Frontend + Backend | **Next.js** | Interfaz de usuario, rutas API, lógica de aplicación |
| Hosting / Deploy | **Vercel** | Despliegue continuo desde GitHub |
| Base de datos + Auth | **Supabase** (Postgres) | Almacena usuarios, diagnósticos, ejercicios e intentos; maneja login/registro |
| Motor de IA adaptativa | **Google Gemini API** | Analiza el diagnóstico, genera el perfil del usuario, genera ejercicios y ajusta la dificultad según cada respuesta |

Principio de diseño: mantener el stack mínimo y usar servicios gestionados (Supabase, Vercel, Gemini) en vez de infraestructura propia. Nada de servidores manuales, nada de ML propio: el razonamiento adaptativo lo hace Gemini vía prompts.

---

## 3. Estructura de base de datos (Supabase)

### Tabla `usuarios`
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid (PK) | generado por Supabase Auth |
| nombre | text | |
| email | text | único |
| fecha_registro | timestamp | default now() |

### Tabla `diagnosticos`
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid (PK) | |
| usuario_id | uuid (FK → usuarios.id) | |
| respuestas | jsonb | respuestas crudas del test inicial |
| perfil_detectado | jsonb / text | resultado generado por Gemini (estilo de aprendizaje, necesidades detectadas, nivel inicial sugerido) |
| fecha | timestamp | default now() |

### Tabla `ejercicios`
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid (PK) | |
| materia | text | `matematicas` \| `lenguaje` |
| nivel_dificultad | int | escala simple, ej. 1-5 |
| contenido | jsonb | enunciado, opciones, formato |
| respuesta_correcta | text | |

### Tabla `intentos`
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid (PK) | |
| usuario_id | uuid (FK → usuarios.id) | |
| ejercicio_id | uuid (FK → ejercicios.id) | |
| respuesta_dada | text | |
| correcto | boolean | |
| tiempo_respuesta | int | segundos, opcional |
| fecha | timestamp | default now() |

Relaciones: `usuarios` 1—N `diagnosticos`; `usuarios` 1—N `intentos`; `ejercicios` 1—N `intentos`.

---

## 4. Flujo de integración con Gemini

1. **Diagnóstico → Perfil**: se envían las `respuestas` del test a Gemini con un prompt estructurado; la respuesta (perfil, nivel inicial sugerido) se guarda en `diagnosticos.perfil_detectado`.
2. **Generación de ejercicio**: Gemini genera o selecciona un ejercicio acorde al perfil y nivel actual del usuario.
3. **Evaluación y ajuste**: tras cada intento, se envía el resultado a Gemini, que decide si sube, mantiene o baja la dificultad del siguiente ejercicio.
4. Todas las llamadas a Gemini deben ser reales (no simuladas) para poder demostrar "operación con IA" ante el jurado.

---

## 5. Entregables obligatorios del hackathon

El proyecto no se considera completo hasta cumplir con **todos** los siguientes entregables:

- [ ] **Repositorio en GitHub**: código fuente completo, historial de commits, README claro.
- [ ] **Video demo de 3 minutos**: mostrando el flujo completo (registro → diagnóstico → ejercicios adaptativos → evidencia de IA en vivo).
- [ ] **Narrativa del proyecto**: problema, solución, impacto en "Educación y Potencial Humano", cómo se usa Gemini.
- [ ] **P&L (ingresos y gastos)**: plantilla simple con proyección de ingresos y gastos operativos (Vercel, Supabase, Gemini API, dominio).
- [ ] **Evidencia de usuarios reales**: registros reales (no ficticios) de un círculo de prueba (familiares/conocidos), con diagnóstico y ejercicios completados, y feedback recopilado.

---

## 6. Alcance del MVP (una semana)

Dentro de alcance:
- Registro/login de usuario (Supabase Auth).
- Test de diagnóstico inicial (10-15 preguntas).
- Generación de perfil vía Gemini.
- Ciclo de ejercicios adaptativos (mate y lenguaje) con ajuste de dificultad vía Gemini.
- Vista simple de progreso del usuario.

Fuera de alcance (no construir salvo que sobre tiempo):
- Paneles de administración avanzados.
- Reportes analíticos complejos.
- Múltiples idiomas.
- Pagos/suscripciones reales (solo se proyectan en el P&L, no se implementan).

---

Ver también `RULES.md` para las normas de desarrollo que deben respetarse en cada cambio de código.
