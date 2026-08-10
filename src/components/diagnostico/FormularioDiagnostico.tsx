'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { obtenerClienteSupabase } from '@/lib/supabase/client';
import { verificarSesionProtegida } from '@/lib/auth/contrato';
import { PREGUNTAS, CANTIDAD_PREGUNTAS } from '@/lib/diagnostico/preguntas';
import { consultarPerfilPropio } from '@/lib/diagnostico/consulta';
import {
  validarRespuestasDiagnostico,
  MENSAJE_ERROR_PERFIL,
  MENSAJE_ERROR_RESPUESTAS,
  MENSAJE_ERROR_SESION,
  type RespuestasDiagnostico,
} from '@/lib/diagnostico/contrato';

type EstadoVista = 'cargando' | 'redirigiendo' | 'respondiendo' | 'generando' | 'error';

export default function FormularioDiagnostico() {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoVista>('cargando');
  // Las respuestas viven en un unico estado y NUNCA se limpian ante un
  // error: es lo que permite reintentar sin volver a responder las 12
  // preguntas.
  const [respuestas, setRespuestas] = useState<RespuestasDiagnostico>({});
  const [mensajeError, setMensajeError] = useState<string | null>(null);

  // Misma proteccion de ruta que VistaProtegida: cada ejecucion del
  // efecto conserva su propia variable de cancelacion local, de modo que
  // bajo React Strict Mode la ejecucion vigente siempre mantiene un
  // manejador activo.
  useEffect(() => {
    let cancelado = false;
    const supabase = obtenerClienteSupabase();

    async function preparar() {
      const sesion = await verificarSesionProtegida({
        getSession: () => supabase.auth.getSession(),
      });
      if (cancelado) return;

      if (sesion === 'sin_sesion') {
        setEstado('redirigiendo');
        router.replace('/login');
        return;
      }

      // Comprobacion previa: si ya hay diagnostico, este formulario no
      // debe llegar a mostrarse. usuario_id es UNIQUE y no hay policy de
      // DELETE, asi que un segundo envio no puede prosperar -- es mejor
      // no ofrecerlo que dejar que falle con un 409.
      const consulta = await consultarPerfilPropio({
        seleccionar: () => supabase.from('diagnosticos').select('perfil_detectado').limit(1),
      });
      if (cancelado) return;

      if (consulta.estado !== 'sin_diagnostico') {
        setEstado('redirigiendo');
        router.replace('/perfil');
        return;
      }

      setEstado('respondiendo');
    }

    preparar();

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
        // El diagnostico ya existia (409). NO es un fallo que el usuario
        // pueda resolver reintentando: su perfil ya esta guardado, asi
        // que se le lleva a verlo en vez de invitarle a repetir un envio
        // que nunca podra prosperar.
        if (cuerpo?.codigo === 'diagnostico_existente') {
          setEstado('redirigiendo');
          router.replace('/perfil');
          return;
        }

        // No se inventa ningun perfil local para disimular el fallo: si
        // Gemini no respondio, no hay perfil que mostrar.
        setMensajeError(
          cuerpo?.codigo === 'sin_sesion' ? MENSAJE_ERROR_SESION : MENSAJE_ERROR_PERFIL
        );
        setEstado('error');
        return;
      }

      // El perfil ya esta persistido: la vista autoritativa es /perfil,
      // que lo relee de la base de datos. Asi lo que se ve tras generar
      // es exactamente lo mismo que se vera tras recargar o volver a
      // entrar, sin una copia en memoria que pueda divergir.
      setEstado('redirigiendo');
      router.replace('/perfil');
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
