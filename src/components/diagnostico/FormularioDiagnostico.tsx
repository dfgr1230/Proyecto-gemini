'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { obtenerClienteSupabase } from '@/lib/supabase/client';
import { verificarSesionProtegida } from '@/lib/auth/contrato';
import { PREGUNTAS, CANTIDAD_PREGUNTAS } from '@/lib/diagnostico/preguntas';
import {
  validarRespuestasDiagnostico,
  MENSAJE_ERROR_PERFIL,
  MENSAJE_ERROR_RESPUESTAS,
  MENSAJE_ERROR_SESION,
  type PerfilDetectado,
  type RespuestasDiagnostico,
} from '@/lib/diagnostico/contrato';

type EstadoVista = 'cargando' | 'redirigiendo' | 'respondiendo' | 'generando' | 'perfil' | 'error';

const ETIQUETA_ESTILO: Record<string, string> = {
  visual: 'Visual',
  auditivo: 'Auditivo',
  lectoescritor: 'Lectura y escritura',
  kinestesico: 'Práctico',
};

export default function FormularioDiagnostico() {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoVista>('cargando');
  // Las respuestas viven en un unico estado y NUNCA se limpian ante un
  // error: es lo que permite reintentar sin volver a responder las 12
  // preguntas.
  const [respuestas, setRespuestas] = useState<RespuestasDiagnostico>({});
  const [perfil, setPerfil] = useState<PerfilDetectado | null>(null);
  const [mensajeError, setMensajeError] = useState<string | null>(null);

  // Misma proteccion de ruta que VistaProtegida: cada ejecucion del
  // efecto conserva su propia variable de cancelacion local, de modo que
  // bajo React Strict Mode la ejecucion vigente siempre mantiene un
  // manejador activo.
  useEffect(() => {
    let cancelado = false;
    const supabase = obtenerClienteSupabase();

    verificarSesionProtegida({
      getSession: () => supabase.auth.getSession(),
    }).then((resultado) => {
      if (cancelado) return;
      if (resultado === 'sin_sesion') {
        setEstado('redirigiendo');
        router.replace('/login');
        return;
      }
      setEstado('respondiendo');
    });

    return () => {
      cancelado = true;
    };
  }, [router]);

  const respondidas = Object.keys(respuestas).length;
  const completo = respondidas === CANTIDAD_PREGUNTAS;
  const generando = estado === 'generando';

  function elegirOpcion(idPregunta: string, idOpcion: string) {
    if (generando) return;
    setRespuestas((previas) => ({ ...previas, [idPregunta]: idOpcion }));
    if (mensajeError) setMensajeError(null);
  }

  async function enviar() {
    if (generando) return;

    // Validacion local con el MISMO contrato que usa el servidor. Es una
    // comodidad para el estudiante: la comprobacion que manda es la del
    // servidor, que se vuelve a ejecutar sobre lo que realmente llegue.
    const validacion = validarRespuestasDiagnostico(respuestas);
    if (!validacion.valido) {
      setMensajeError(MENSAJE_ERROR_RESPUESTAS);
      return;
    }

    setEstado('generando');
    setMensajeError(null);

    const supabase = obtenerClienteSupabase();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setMensajeError(MENSAJE_ERROR_SESION);
      setEstado('error');
      return;
    }

    try {
      const respuesta = await fetch('/api/perfil', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ respuestas: validacion.respuestas }),
      });

      const cuerpo = await respuesta.json().catch(() => null);

      if (!respuesta.ok || !cuerpo?.ok || !cuerpo?.perfil) {
        // No se inventa ningun perfil local para disimular el fallo: si
        // Gemini no respondio, no hay perfil que mostrar.
        setMensajeError(
          cuerpo?.codigo === 'sin_sesion' ? MENSAJE_ERROR_SESION : MENSAJE_ERROR_PERFIL
        );
        setEstado('error');
        return;
      }

      setPerfil(cuerpo.perfil as PerfilDetectado);
      setEstado('perfil');
    } catch {
      setMensajeError(MENSAJE_ERROR_PERFIL);
      setEstado('error');
    }
  }

  if (estado === 'cargando' || estado === 'redirigiendo') {
    return (
      <div
        role="status"
        className="w-full max-w-2xl rounded-lg border border-black/[.08] bg-white p-8 text-center dark:border-white/[.145] dark:bg-zinc-950"
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Cargando…</p>
      </div>
    );
  }

  if (estado === 'perfil' && perfil) {
    return (
      <div
        role="status"
        className="w-full max-w-2xl rounded-lg border border-black/[.08] bg-white p-8 dark:border-white/[.145] dark:bg-zinc-950"
      >
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Tu orientación de aprendizaje</h1>

        <dl className="mt-6 flex flex-col gap-4">
          <div>
            <dt className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Cómo aprendes mejor</dt>
            <dd className="text-base text-zinc-950 dark:text-zinc-50">
              {ETIQUETA_ESTILO[perfil.estilo_aprendizaje] ?? perfil.estilo_aprendizaje}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Nivel inicial sugerido</dt>
            <dd className="text-base text-zinc-950 dark:text-zinc-50">{perfil.nivel_sugerido} de 5</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Qué significa</dt>
            <dd className="text-base text-zinc-950 dark:text-zinc-50">{perfil.explicacion}</dd>
          </div>
        </dl>

        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
          Esta es una orientación inicial para empezar, no una evaluación definitiva: se irá ajustando
          a medida que practiques.
        </p>

        <Link
          href="/"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
        >
          Volver al inicio
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl rounded-lg border border-black/[.08] bg-white p-8 dark:border-white/[.145] dark:bg-zinc-950">
      <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Test de diagnóstico inicial</h1>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        Son {CANTIDAD_PREGUNTAS} preguntas cortas sobre cómo prefieres aprender. No hay respuestas
        correctas ni incorrectas.
      </p>

      <p role="status" aria-live="polite" className="mt-4 text-sm font-medium text-zinc-800 dark:text-zinc-200">
        Respondidas {respondidas} de {CANTIDAD_PREGUNTAS}
      </p>

      <div className="mt-8 flex flex-col gap-8">
        {PREGUNTAS.map((pregunta, indice) => (
          <fieldset key={pregunta.id} disabled={generando} className="flex flex-col gap-3">
            <legend className="text-base font-medium text-zinc-950 dark:text-zinc-50">
              {indice + 1}. {pregunta.enunciado}
            </legend>
            {pregunta.opciones.map((opcion) => (
              <label
                key={opcion.id}
                htmlFor={`${pregunta.id}-${opcion.id}`}
                className="flex cursor-pointer items-center gap-3 rounded-md border border-black/[.08] px-3 py-2 text-sm text-zinc-800 hover:bg-zinc-50 dark:border-white/[.145] dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                <input
                  type="radio"
                  id={`${pregunta.id}-${opcion.id}`}
                  name={pregunta.id}
                  value={opcion.id}
                  checked={respuestas[pregunta.id] === opcion.id}
                  onChange={() => elegirOpcion(pregunta.id, opcion.id)}
                  disabled={generando}
                />
                {opcion.texto}
              </label>
            ))}
          </fieldset>
        ))}
      </div>

      {mensajeError && (
        <p role="alert" className="mt-6 text-sm text-red-600 dark:text-red-400">
          {mensajeError}
        </p>
      )}

      <button
        type="button"
        onClick={enviar}
        disabled={generando || !completo}
        aria-busy={generando}
        className="mt-8 flex h-11 w-full items-center justify-center rounded-full bg-foreground text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-[#ccc]"
      >
        {generando
          ? 'Generando tu perfil…'
          : estado === 'error'
            ? 'Reintentar'
            : 'Generar mi perfil'}
      </button>

      {!completo && (
        <p className="mt-3 text-center text-sm text-zinc-600 dark:text-zinc-400">
          Responde las {CANTIDAD_PREGUNTAS} preguntas para continuar.
        </p>
      )}
    </div>
  );
}
