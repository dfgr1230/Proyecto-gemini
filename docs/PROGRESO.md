# PROGRESO.md — Estado actual del proyecto

Este archivo se actualiza al cierre de cada día de trabajo. Refleja el estado real más reciente del proyecto.

---

## Estado general

| Día | Estado |
|---|---|
| **Día 1 — Cimientos** | ✅ 100% completado |
| Día 2 — Datos y login | ⬜ Pendiente (siguiente paso) |
| Día 3 — Test de diagnóstico | ⬜ Pendiente |
| Día 4 — Conectar la IA | ⬜ Pendiente |
| Día 5 — Ciclo adaptativo | ⬜ Pendiente |
| Día 6 — Pulido + prueba real | ⬜ Pendiente |
| Día 7 — Cierre | ⬜ Pendiente |

---

## Día 1 — Cimientos (✅ completado)

- [x] Proyecto Next.js inicializado en la raíz (App Router, TypeScript, Tailwind CSS).
- [x] `CLAUDE.md` y `RULES.md` preservados sin modificar durante la inicialización.
- [x] Repositorio Git local creado, con historial de commits limpio.
- [x] `.gitignore` configurado: bloquea `.env*` para nunca subir claves reales, con excepción explícita para `.env.example`.
- [x] `.env.example` creado como plantilla, con las variables:
  - `GEMINI_API_KEY`
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [x] Compilación verificada sin errores ni advertencias (`npm run build`).
- [x] Raíz del workspace fijada en `next.config.ts` para evitar ambigüedad con otros proyectos en `D:\dev`.

**En proceso (fuera del código, a cargo del usuario):**
- Subir el repositorio a una cuenta de GitHub del usuario (repo nuevo).
- Enlazar ese repositorio en Vercel para obtener la URL pública.
- Las variables de entorno en Vercel se están configurando **en blanco por el momento** (se completarán con las claves reales de Gemini y Supabase en el Día 2 y Día 4).

---

## Siguiente paso exacto: Día 2 — Datos y login

1. Crear el proyecto en **Supabase**.
2. Crear las 4 tablas definidas en `CLAUDE.md` §3:
   - `usuarios`
   - `diagnosticos`
   - `ejercicios`
   - `intentos`
3. Activar **login por email** con Supabase Auth.
4. Conectar Next.js con Supabase (registro / inicio de sesión funcionando de extremo a extremo).

---

*Última actualización: cierre del Día 1.*
