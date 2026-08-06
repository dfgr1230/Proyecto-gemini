'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { obtenerClienteSupabase } from '@/lib/supabase/client';
import { ejecutarConfirmacion } from '@/lib/auth/contrato';

type EstadoConfirmacion = 'cargando' | 'confirmado' | 'enlace_invalido' | 'error';

export default function ConfirmacionCorreo() {
  const [estado, setEstado] = useState<EstadoConfirmacion>('cargando');
  const [mensajeError, setMensajeError] = useState<string | null>(null);

  // Evita procesar dos veces bajo React Strict Mode (que invoca los
  // efectos dos veces en desarrollo). El propio SDK ya es idempotente
  // (initialize() cachea su resultado), pero esta guardia evita ademas
  // una segunda ejecucion innecesaria de este efecto.
  const yaIniciado = useRef(false);

  useEffect(() => {
    if (yaIniciado.current) return;
    yaIniciado.current = true;

    let cancelado = false;
    const supabase = obtenerClienteSupabase();

    ejecutarConfirmacion({
      initialize: () => supabase.auth.initialize(),
      getSession: () => supabase.auth.getSession(),
    }).then((resultado) => {
      if (cancelado) return;
      if (resultado.estado === 'error') {
        setMensajeError(resultado.mensaje);
        setEstado('error');
      } else {
        setEstado(resultado.estado);
      }
    });

    return () => {
      cancelado = true;
    };
  }, []);

  return (
    <div
      className="w-full max-w-sm rounded-lg border border-black/[.08] bg-white p-8 text-center dark:border-white/[.145] dark:bg-zinc-950"
      aria-live="polite"
    >
      {estado === 'cargando' && (
        <div role="status">
          <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Confirmando tu correo…</h1>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">Esto solo toma un momento.</p>
        </div>
      )}

      {estado === 'confirmado' && (
        <div role="status">
          <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Tu correo fue confirmado correctamente.</h1>
          <Link
            href="/login"
            className="mt-4 inline-flex h-11 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
          >
            Ir a iniciar sesión
          </Link>
        </div>
      )}

      {estado === 'enlace_invalido' && (
        <div role="alert">
          <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Este enlace de confirmación no es válido.</h1>
          <Link
            href="/login"
            className="mt-4 inline-flex h-11 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
          >
            Ir a iniciar sesión
          </Link>
        </div>
      )}

      {estado === 'error' && (
        <div role="alert">
          <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">{mensajeError}</h1>
          <Link
            href="/login"
            className="mt-4 inline-flex h-11 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
          >
            Ir a iniciar sesión
          </Link>
        </div>
      )}
    </div>
  );
}
