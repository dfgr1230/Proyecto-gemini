'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { obtenerClienteSupabase } from '@/lib/supabase/client';
import { verificarSesionProtegida } from '@/lib/auth/contrato';
import { consultarPerfilPropio } from '@/lib/diagnostico/consulta';
import type { PerfilDetectado } from '@/lib/diagnostico/contrato';
import {
  interpretarResultadoIntento,
  orientacionParaEstilo,
  resumirProgreso,
  seleccionarEjercicio,
  validarEjercicio,
  MENSAJE_ERROR_ACTIVIDAD,
  MENSAJE_ERROR_INTENTO,
  MENSAJE_SIN_EJERCICIOS,
  type EjercicioDisponible,
  type IntentoRegistrado,
  type Progreso,
} from '@/lib/actividad/contrato';

type EstadoVista = 'cargando' | 'redirigiendo' | 'respondiendo' | 'enviando' | 'completada' | 'sin_actividad' | 'error';

const ETIQUETA_ESTILO: Record<string, string> = {
  visual: 'Visual',
  auditivo: 'Auditivo',
  lectoescritor: 'Lectura y escritura',
  kinestesico: 'Práctico',
};

const TIEMPO_MAXIMO_SEGUNDOS = 3600;

export default function VistaActividad() {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoVista>('cargando');
  const [perfil, setPerfil] = useState<PerfilDetectado | null>(null);
  const [ejercicio, setEjercicio] = useState<EjercicioDisponible | null>(null);
  const [nivelExacto, setNivelExacto] = useState(true);
  // Se conservan los datos CRUDOS, no el resumen: asi el progreso tras
  // enviar se calcula con la misma funcion que lo reconstruye al
  // recargar, y no hay dos caminos que puedan divergir.
  const [ejercicios, setEjercicios] = useState<readonly EjercicioDisponible[]>([]);
  const [intentos, setIntentos] = useState<readonly IntentoRegistrado[]>([]);
  const [opcionElegida, setOpcionElegida] = useState<string | null>(null);
  const [mensajeError, setMensajeError] = useState<string | null>(null);

  // Marca de tiempo de cuando el ejercicio quedo a la vista. Solo se usa
  // para el parametro opcional de la RPC.
  const mostradoEn = useRef<number | null>(null);

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

      // La actividad se elige a partir del perfil: sin perfil no hay
      // nivel de partida, y adivinarlo seria inventar la parte
      // adaptativa.
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

      // Se piden SOLO las columnas publicas. ejercicios_respuestas no se
      // consulta aqui ni en ningun punto del cliente: tiene RLS activo
      // sin policies, de modo que la respuesta oficial es inalcanzable
      // desde el navegador aunque este codigo lo intentara.
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
        // Una fila malformada se descarta en silencio: el resto del
        // banco sigue siendo utilizable.
        if (validacion.valido) disponibles.push(validacion.ejercicio);
      }

      const registrados = (rIntentos.data ?? []) as IntentoRegistrado[];
      setEjercicios(disponibles);
      setIntentos(registrados);

      const seleccion = seleccionarEjercicio(disponibles, consulta.perfil.nivel_sugerido);
      if (seleccion.estado === 'sin_ejercicios') {
        setEstado('sin_actividad');
        return;
      }
      setEjercicio(seleccion.ejercicio);
      setNivelExacto(seleccion.exacto);

      // Si ya hay un intento sobre este ejercicio, se muestra el
      // resultado en vez del formulario. Asi una recarga nunca ofrece
      // repetir lo ya registrado ni crea un segundo intento sola.
      const yaIntentado = registrados.some((i) => i.ejercicio_id === seleccion.ejercicio.id);
      if (yaIntentado) {
        setEstado('completada');
        return;
      }

      mostradoEn.current = Date.now();
      setEstado('respondiendo');
    }

    cargar();

    return () => {
      cancelado = true;
    };
  }, [router]);

  async function enviar() {
    // Guardia contra doble envio: mientras la RPC esta en vuelo, y
    // definitivamente una vez completada.
    if (estado !== 'respondiendo') return;
    if (opcionElegida === null || ejercicio === null || perfil === null) return;

    setEstado('enviando');
    setMensajeError(null);

    const supabase = obtenerClienteSupabase();

    const transcurrido =
      mostradoEn.current === null
        ? null
        : Math.min(TIEMPO_MAXIMO_SEGUNDOS, Math.max(0, Math.round((Date.now() - mostradoEn.current) / 1000)));

    // Se envian SOLO los parametros que la RPC admite. No se manda
    // "correcto" ni "usuario_id": lo primero lo decide la base de datos
    // comparando con ejercicios_respuestas, lo segundo sale de
    // auth.uid() dentro de la funcion.
    const respuesta = await supabase.rpc('registrar_intento', {
      p_ejercicio_id: ejercicio.id,
      p_respuesta_dada: opcionElegida,
      p_tiempo_respuesta: transcurrido,
    });

    const resultado = interpretarResultadoIntento(respuesta);
    if (resultado.estado === 'no_registrado') {
      setMensajeError(MENSAJE_ERROR_INTENTO);
      setEstado('error');
      return;
    }

    // Se anade el intento a la lista cruda; el resumen sale despues de
    // resumirProgreso, igual que tras una recarga.
    setIntentos((previos) => [
      ...previos,
      {
        id: `local-${ejercicio.id}`,
        ejercicio_id: ejercicio.id,
        correcto: resultado.correcto,
        fecha: new Date().toISOString(),
      },
    ]);
    setEstado('completada');
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
        <Enlace href="/perfil">Volver a mi perfil</Enlace>
      </Tarjeta>
    );
  }

  if (perfil === null || ejercicio === null) {
    return <Tarjeta><p className="text-sm text-zinc-600 dark:text-zinc-400">Cargando…</p></Tarjeta>;
  }

  const completada = estado === 'completada';
  const enviando = estado === 'enviando';
  const progreso: Progreso = resumirProgreso(intentos, ejercicios, perfil.nivel_sugerido);

  return (
    <div className="w-full max-w-2xl rounded-lg border border-black/[.08] bg-white p-8 dark:border-white/[.145] dark:bg-zinc-950">
      <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Tu actividad</h1>

      {/* Trazabilidad honesta: se dice exactamente que aporto Gemini
          (el perfil) y que se derivo de el (la seleccion). */}
      <dl className="mt-4 flex flex-col gap-1 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-600 dark:text-zinc-400">Estilo detectado</dt>
          <dd className="text-zinc-950 dark:text-zinc-50">
            {ETIQUETA_ESTILO[perfil.estilo_aprendizaje] ?? perfil.estilo_aprendizaje}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-600 dark:text-zinc-400">Nivel sugerido por Gemini</dt>
          <dd className="text-zinc-950 dark:text-zinc-50">{perfil.nivel_sugerido} de 5</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-600 dark:text-zinc-400">Nivel de esta actividad</dt>
          <dd className="text-zinc-950 dark:text-zinc-50">{ejercicio.nivel_dificultad} de 5</dd>
        </div>
      </dl>

      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        {nivelExacto
          ? 'Esta actividad se eligió del banco de ejercicios porque coincide con el nivel que Gemini sugirió a partir de tu diagnóstico.'
          : `No hay ninguna actividad de nivel ${perfil.nivel_sugerido}, así que se eligió la más cercana disponible.`}
      </p>

      <hr className="my-6 border-black/[.08] dark:border-white/[.145]" />

      {!completada && (
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {orientacionParaEstilo(perfil.estilo_aprendizaje)}
        </p>
      )}

      <p className="mt-4 text-lg text-zinc-950 dark:text-zinc-50">{ejercicio.contenido.enunciado}</p>

      {!completada && (
        <>
          <fieldset disabled={enviando} className="mt-6 flex flex-col gap-3">
            <legend className="sr-only">Opciones de respuesta</legend>
            {Object.entries(ejercicio.contenido.opciones).map(([id, texto]) => (
              <label
                key={id}
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
            {enviando ? 'Enviando…' : 'Enviar respuesta'}
          </button>

          {opcionElegida === null && (
            <p className="mt-3 text-center text-sm text-zinc-600 dark:text-zinc-400">
              Elige una opción para continuar.
            </p>
          )}
        </>
      )}

      {completada && (
        <div role="status" className="mt-6">
          <p className="text-base font-semibold text-zinc-950 dark:text-zinc-50">
            Actividad completada — {progreso.ultimoCorrecto ? 'respuesta correcta' : 'respuesta incorrecta'}
          </p>

          <dl className="mt-6 flex flex-col gap-1 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-600 dark:text-zinc-400">Actividades completadas</dt>
              <dd className="text-zinc-950 dark:text-zinc-50">{progreso.completadas}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-600 dark:text-zinc-400">Aciertos</dt>
              <dd className="text-zinc-950 dark:text-zinc-50">
                {progreso.aciertos} de {progreso.completadas}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-600 dark:text-zinc-400">Nivel realizado</dt>
              <dd className="text-zinc-950 dark:text-zinc-50">{progreso.nivelUltimoEjercicio} de 5</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-600 dark:text-zinc-400">Nivel inicial de Gemini</dt>
              <dd className="text-zinc-950 dark:text-zinc-50">{progreso.nivelInicialSugerido} de 5</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="font-medium text-zinc-800 dark:text-zinc-200">Próximo nivel recomendado</dt>
              <dd className="font-medium text-zinc-950 dark:text-zinc-50">
                {progreso.nivelProximoRecomendado} de 5
              </dd>
            </div>
          </dl>

          <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
            {progreso.seMantiene
              ? `Ya estás en el límite de la escala, así que el nivel se mantiene en ${progreso.nivelProximoRecomendado}.`
              : progreso.ultimoCorrecto
                ? 'Como acertaste, el próximo reto sube un nivel.'
                : 'Como no acertaste, el próximo reto baja un nivel para afianzar la base.'}
          </p>

          <Enlace href="/perfil">Volver a mi perfil</Enlace>
        </div>
      )}
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
