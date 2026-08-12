'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { obtenerClienteSupabase } from '@/lib/supabase/client';
import { verificarSesionProtegida } from '@/lib/auth/contrato';
import { consultarPerfilPropio } from '@/lib/diagnostico/consulta';
import type { PerfilDetectado } from '@/lib/diagnostico/contrato';
import {
  seleccionarEjercicio,
  validarEjercicio,
  MENSAJE_ERROR_ACTIVIDAD,
  MENSAJE_SIN_EJERCICIOS,
  type EjercicioDisponible,
  type IntentoRegistrado,
} from '@/lib/actividad/contrato';
import {
  MENSAJE_ANALISIS_NO_CONSERVADO,
  MENSAJE_ANALISIS_NO_DISPONIBLE,
  type AnalisisAdaptativo,
} from '@/lib/adaptativo/contrato';
import { MENSAJE_SIN_PENDIENTES } from '@/lib/adaptativo/siguiente';

// Vista del CICLO ADAPTATIVO. Es una ruta NUEVA y no una modificacion de
// /actividad: aquella sigue funcionando exactamente igual (RULES.md
// seccion 1, cero regresiones) y demuestra la seleccion determinista a
// partir del perfil. Esta demuestra el ciclo completo, donde la decision
// educativa despues de cada respuesta la toma Gemini en el servidor.
//
// El navegador NUNCA habla con Gemini: envia la respuesta a
// /api/adaptar y recibe de vuelta el analisis ya validado. La clave vive
// solo en el servidor.

type EstadoVista =
  | 'cargando'
  | 'redirigiendo'
  | 'respondiendo'
  | 'enviando'
  | 'analizado'
  | 'sin_actividad'
  | 'error';

interface Iteracion {
  numero: number;
  correcto: boolean;
  reutilizado: boolean;
  nivelRespondido: number;
  analisis: AnalisisAdaptativo;
  analisisPrevio: AnalisisAdaptativo | null;
  conservacion: 'conservado' | 'almacen_no_disponible' | 'credencial_ausente' | 'no_conservado';
  ia: { modelo: string; duracion_ms: number } | null;
}

const ETIQUETA_ESTILO: Record<string, string> = {
  visual: 'Visual',
  auditivo: 'Auditivo',
  lectoescritor: 'Lectura y escritura',
  kinestesico: 'Práctico',
};

const TIEMPO_MAXIMO_SEGUNDOS = 3600;

export default function VistaCiclo() {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoVista>('cargando');
  const [perfil, setPerfil] = useState<PerfilDetectado | null>(null);
  const [ejercicio, setEjercicio] = useState<EjercicioDisponible | null>(null);
  const [opcionElegida, setOpcionElegida] = useState<string | null>(null);
  const [historial, setHistorial] = useState<Iteracion[]>([]);
  const [mensajeError, setMensajeError] = useState<string | null>(null);
  const [agotado, setAgotado] = useState(false);
  // Solo para el boton de recuperacion del estado de error: evita que un
  // segundo clic dispare otra recarga mientras la primera esta en curso.
  const [recargando, setRecargando] = useState(false);

  const mostradoEn = useRef<number | null>(null);

  const iniciarCronometro = useCallback(() => {
    mostradoEn.current = Date.now();
  }, []);

  useEffect(() => {
    let cancelado = false;
    const supabase = obtenerClienteSupabase();

    async function cargar() {
      const sesion = await verificarSesionProtegida({
        getSession: () => supabase.auth.getSession(),
      });
      if (cancelado) return;
      if (sesion === 'sin_sesion') {
        setEstado('redirigiendo');
        router.replace('/login');
        return;
      }

      const consulta = await consultarPerfilPropio({
        seleccionar: () => supabase.from('diagnosticos').select('perfil_detectado').limit(1),
      });
      if (cancelado) return;
      if (consulta.estado !== 'con_perfil') {
        setEstado('redirigiendo');
        router.replace(consulta.estado === 'sin_diagnostico' ? '/diagnostico' : '/perfil');
        return;
      }
      setPerfil(consulta.perfil);

      // Solo columnas publicas. ejercicios_respuestas no se consulta aqui
      // ni en ningun punto del cliente.
      const [rEjercicios, rIntentos] = await Promise.all([
        supabase.from('ejercicios').select('id,materia,nivel_dificultad,contenido'),
        supabase.from('intentos').select('id,ejercicio_id,correcto,fecha'),
      ]);
      if (cancelado) return;

      if (rEjercicios.error || rIntentos.error) {
        setMensajeError(MENSAJE_ERROR_ACTIVIDAD);
        setEstado('error');
        return;
      }

      const disponibles: EjercicioDisponible[] = [];
      for (const fila of rEjercicios.data ?? []) {
        const validacion = validarEjercicio(fila);
        if (validacion.valido) disponibles.push(validacion.ejercicio);
      }

      const registrados = (rIntentos.data ?? []) as IntentoRegistrado[];
      const respondidos = new Set(registrados.map((i) => i.ejercicio_id));
      const pendientes = disponibles.filter((e) => !respondidos.has(e.id));

      // La PRIMERA actividad se elige con el nivel del perfil, igual que
      // en /actividad. A partir de la segunda manda la recomendacion de
      // Gemini, que llega en la respuesta de /api/adaptar.
      const seleccion = seleccionarEjercicio(
        pendientes.length > 0 ? pendientes : disponibles,
        consulta.perfil.nivel_sugerido
      );
      if (seleccion.estado === 'sin_ejercicios') {
        setEstado('sin_actividad');
        return;
      }
      if (pendientes.length === 0) setAgotado(true);

      setEjercicio(seleccion.ejercicio);
      iniciarCronometro();
      setEstado('respondiendo');
    }

    cargar();

    return () => {
      cancelado = true;
    };
  }, [router, iniciarCronometro]);

  async function enviar() {
    // Guardia contra doble envio, ademas del boton deshabilitado. El
    // servidor tiene su propia prevencion de duplicados: esta es solo la
    // primera barrera.
    if (estado !== 'respondiendo') return;
    if (opcionElegida === null || ejercicio === null) return;

    setEstado('enviando');
    setMensajeError(null);

    const supabase = obtenerClienteSupabase();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setEstado('redirigiendo');
      router.replace('/login');
      return;
    }

    const transcurrido =
      mostradoEn.current === null
        ? null
        : Math.min(
            TIEMPO_MAXIMO_SEGUNDOS,
            Math.max(0, Math.round((Date.now() - mostradoEn.current) / 1000))
          );

    let respuesta: Response;
    try {
      respuesta = await fetch('/api/adaptar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ejercicio_id: ejercicio.id,
          respuesta_dada: opcionElegida,
          tiempo_respuesta: transcurrido,
        }),
      });
    } catch {
      setMensajeError(MENSAJE_ANALISIS_NO_DISPONIBLE);
      setEstado('error');
      return;
    }

    const cuerpo = await respuesta.json().catch(() => null);

    if (!respuesta.ok || cuerpo === null || cuerpo.ok !== true) {
      // Estado recuperable y honesto: si el intento quedo registrado se
      // dice, para que nadie repita una actividad ya contabilizada. En
      // ningun caso se muestra una adaptacion que no ocurrio.
      const registrado = cuerpo !== null && cuerpo.intento != null;
      setMensajeError(
        registrado
          ? MENSAJE_ANALISIS_NO_DISPONIBLE
          : 'No fue posible completar el ciclo en este momento. Vuelve a intentarlo en unos segundos.'
      );
      setEstado('error');
      return;
    }

    setHistorial((previas) => [
      ...previas,
      {
        numero: cuerpo.iteracion,
        correcto: cuerpo.intento.correcto,
        reutilizado: cuerpo.intento.reutilizado,
        nivelRespondido: ejercicio.nivel_dificultad,
        analisis: cuerpo.analisis,
        analisisPrevio: cuerpo.analisis_previo ?? null,
        conservacion: cuerpo.conservacion,
        ia: cuerpo.ia ?? null,
      },
    ]);

    // La SIGUIENTE actividad viene decidida por el servidor a partir de
    // la recomendacion de Gemini. El navegador no la elige.
    const siguiente = cuerpo.siguiente;
    if (siguiente?.estado === 'elegida') {
      setEjercicio(siguiente.ejercicio as EjercicioDisponible);
      setAgotado(false);
    } else {
      setAgotado(true);
    }

    setOpcionElegida(null);
    setEstado('analizado');
  }

  function continuar() {
    if (agotado) return;
    iniciarCronometro();
    setEstado('respondiendo');
  }

  if (estado === 'cargando' || estado === 'redirigiendo') {
    return <Tarjeta><p className="text-sm text-zinc-600 dark:text-zinc-400">Cargando…</p></Tarjeta>;
  }

  if (estado === 'sin_actividad') {
    return (
      <Tarjeta>
        <p className="text-sm text-zinc-800 dark:text-zinc-200">{MENSAJE_SIN_EJERCICIOS}</p>
        <Enlace href="/perfil">Volver a mi perfil</Enlace>
      </Tarjeta>
    );
  }

  if (estado === 'error') {
    return (
      <Tarjeta alerta>
        <p className="text-sm text-zinc-800 dark:text-zinc-200">
          {mensajeError ?? MENSAJE_ERROR_ACTIVIDAD}
        </p>

        {/* RECUPERACION REAL DESDE EL ERROR.
            Antes esto era <Link href="/ciclo"> estando YA en /ciclo. El
            App Router reconcilia el mismo componente en la misma
            posicion del arbol, asi que no se remonta: el efecto de carga
            no se vuelve a ejecutar y "estado" sigue valiendo 'error'. El
            boton no hacia nada, y era la UNICA accion de esta pantalla,
            de modo que el usuario quedaba atrapado.

            Recargar la ruta actual es lo unico que garantiza volver a
            ejecutar el efecto (router.refresh() no remonta componentes
            de cliente ni reejecuta sus efectos). La recarga RELEE de
            Supabase el perfil, el banco y el historial de intentos: un
            intento ya registrado no se pierde ni se reenvia, porque el
            propio efecto lo descarta de "pendientes". */}
        <div>
          <button
            type="button"
            onClick={() => {
              if (recargando) return;
              setRecargando(true);
              window.location.reload();
            }}
            disabled={recargando}
            aria-busy={recargando}
            className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-[#ccc]"
          >
            {recargando ? 'Reintentando…' : 'Reintentar'}
          </button>
        </div>

        {/* Segunda salida: si el reintento tampoco funciona, esta
            pantalla debe dejar marchar al usuario en vez de encerrarlo. */}
        <Enlace href="/perfil">Volver a mi perfil</Enlace>
      </Tarjeta>
    );
  }

  if (perfil === null || ejercicio === null) {
    return <Tarjeta><p className="text-sm text-zinc-600 dark:text-zinc-400">Cargando…</p></Tarjeta>;
  }

  const ultima = historial.length > 0 ? historial[historial.length - 1] : null;
  const enviando = estado === 'enviando';
  const mostrandoAnalisis = estado === 'analizado' && ultima !== null;

  return (
    <div className="w-full max-w-2xl rounded-lg border border-black/[.08] bg-white p-8 dark:border-white/[.145] dark:bg-zinc-950">
      <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Ciclo adaptativo</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Después de cada respuesta, Gemini analiza tu evidencia en el servidor y decide qué conviene
        hacer a continuación.
      </p>

      <dl className="mt-4 flex flex-col gap-1 text-sm">
        <Fila etiqueta="Estilo detectado en el diagnóstico">
          {ETIQUETA_ESTILO[perfil.estilo_aprendizaje] ?? perfil.estilo_aprendizaje}
        </Fila>
        <Fila etiqueta="Nivel inicial sugerido por Gemini">{perfil.nivel_sugerido} de 5</Fila>
        <Fila etiqueta="Interacciones completadas">{historial.length}</Fila>
      </dl>

      <hr className="my-6 border-black/[.08] dark:border-white/[.145]" />

      {mostrandoAnalisis ? (
        <>
          <PanelAnalisis iteracion={ultima} />

          {agotado ? (
            <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">{MENSAJE_SIN_PENDIENTES}</p>
          ) : (
            <>
              <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
                La siguiente actividad se eligió con la recomendación de arriba:{' '}
                {ultima.analisis.siguiente_actividad_materia}, nivel{' '}
                {ejercicio.nivel_dificultad} de 5.
              </p>
              <button
                type="button"
                onClick={continuar}
                className="mt-4 flex h-12 w-full items-center justify-center rounded-full bg-foreground text-base font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
              >
                Continuar con la siguiente actividad
              </button>
            </>
          )}

          <Enlace href="/perfil">Volver a mi perfil</Enlace>
        </>
      ) : (
        <>
          <p className="text-lg text-zinc-950 dark:text-zinc-50">{ejercicio.contenido.enunciado}</p>

          <fieldset disabled={enviando} className="mt-6 flex flex-col gap-3">
            <legend className="sr-only">Opciones de respuesta</legend>
            {Object.entries(ejercicio.contenido.opciones).map(([id, texto]) => (
              <label
                key={`${ejercicio.id}-${id}`}
                htmlFor={`opcion-${id}`}
                className="flex cursor-pointer items-center gap-3 rounded-md border border-black/[.08] px-4 py-3 text-base text-zinc-800 hover:bg-zinc-50 dark:border-white/[.145] dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                <input
                  type="radio"
                  id={`opcion-${id}`}
                  name="opcion"
                  value={id}
                  checked={opcionElegida === id}
                  onChange={() => setOpcionElegida(id)}
                  disabled={enviando}
                />
                {texto}
              </label>
            ))}
          </fieldset>

          <button
            type="button"
            onClick={enviar}
            disabled={enviando || opcionElegida === null}
            aria-busy={enviando}
            className="mt-8 flex h-12 w-full items-center justify-center rounded-full bg-foreground text-base font-medium text-background transition-colors hover:bg-[#383838] disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-[#ccc]"
          >
            {enviando ? 'Analizando con Gemini…' : 'Enviar respuesta'}
          </button>
        </>
      )}
    </div>
  );
}

// Panel del analisis. Muestra los ocho puntos que devolvio el modelo y,
// cuando existe iteracion previa, QUE cambio respecto de ella -- que es
// la evidencia visible de que el ciclo es acumulativo.
function PanelAnalisis({ iteracion }: { iteracion: Iteracion }) {
  const previo = iteracion.analisisPrevio;
  const cambioNivel = previo !== null && previo.nivel_recomendado !== iteracion.analisis.nivel_recomendado;

  return (
    <div role="status">
      <p className="text-base font-semibold text-zinc-950 dark:text-zinc-50">
        Interacción {iteracion.numero} — {iteracion.correcto ? 'respuesta correcta' : 'respuesta incorrecta'}
        {iteracion.reutilizado ? ' (ya estaba registrada)' : ''}
      </p>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        La corrección la hizo la base de datos, no el navegador ni el modelo.
      </p>

      <h2 className="mt-6 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
        Análisis de Gemini
      </h2>

      <dl className="mt-3 flex flex-col gap-3 text-sm">
        <Bloque etiqueta="Fortalezas observadas" items={iteracion.analisis.fortalezas} />
        <Bloque etiqueta="Dificultades observadas" items={iteracion.analisis.dificultades} />
        <Fila etiqueta="Habilidad prioritaria">{iteracion.analisis.habilidad_prioritaria}</Fila>
        <Fila etiqueta="Nivel recomendado">
          {iteracion.analisis.nivel_recomendado} de 5
          {cambioNivel ? ` (antes ${previo.nivel_recomendado})` : ''}
        </Fila>
        <Fila etiqueta="Apoyo pedagógico">{iteracion.analisis.apoyo_pedagogico}</Fila>
        <Fila etiqueta="Siguiente actividad">
          {iteracion.analisis.siguiente_actividad_materia} — {iteracion.analisis.siguiente_actividad_enfoque}
        </Fila>
        <Fila etiqueta="Justificación">{iteracion.analisis.justificacion}</Fila>
        <Fila etiqueta="Grado de confianza">{iteracion.analisis.confianza}</Fila>
      </dl>

      {previo !== null && (
        <p className="mt-4 rounded-md bg-zinc-50 p-3 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          Este análisis partió del anterior (nivel recomendado {previo.nivel_recomendado},
          prioridad «{previo.habilidad_prioritaria}») y de tus respuestas ya registradas.
        </p>
      )}

      {iteracion.conservacion !== 'conservado' && (
        <p className="mt-4 text-sm text-amber-700 dark:text-amber-400">
          {MENSAJE_ANALISIS_NO_CONSERVADO}
        </p>
      )}

      {iteracion.ia !== null && (
        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-500">
          Generado por {iteracion.ia.modelo} en {iteracion.ia.duracion_ms} ms.
        </p>
      )}
    </div>
  );
}

function Fila({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
      <dt className="text-zinc-600 dark:text-zinc-400">{etiqueta}</dt>
      <dd className="text-zinc-950 sm:max-w-sm sm:text-right dark:text-zinc-50">{children}</dd>
    </div>
  );
}

function Bloque({ etiqueta, items }: { etiqueta: string; items: string[] }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-zinc-600 dark:text-zinc-400">{etiqueta}</dt>
      <dd className="text-zinc-950 dark:text-zinc-50">
        <ul className="list-disc pl-5">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </dd>
    </div>
  );
}

function Tarjeta({ children, alerta = false }: { children: React.ReactNode; alerta?: boolean }) {
  return (
    <div
      role={alerta ? 'alert' : 'status'}
      className="w-full max-w-2xl rounded-lg border border-black/[.08] bg-white p-8 text-center dark:border-white/[.145] dark:bg-zinc-950"
    >
      {children}
    </div>
  );
}

function Enlace({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
    >
      {children}
    </Link>
  );
}
