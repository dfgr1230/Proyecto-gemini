'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { obtenerClienteSupabase } from '@/lib/supabase/client';
import { ejecutarConfirmacion, type ResultadoConfirmacion } from '@/lib/auth/contrato';

type EstadoConfirmacion = 'cargando' | 'confirmado' | 'enlace_invalido' | 'error';

export default function ConfirmacionCorreo() {
  const [estado, setEstado] = useState<EstadoConfirmacion>('cargando');
  const [mensajeError, setMensajeError] = useState<string | null>(null);

  // Guarda la PROMESA de confirmacion, no una bandera de "ya se
  // ejecuto". La diferencia importa bajo React Strict Mode, que en
  // desarrollo hace montaje -> limpieza -> nuevo montaje: una bandera
  // que impida entrar a la segunda ejecucion deja como unico manejador
  // el de la primera, que su propia limpieza ya cancelo
  // (cancelado = true) antes de que la promesa resolviera -- ninguna
  // ejecucion aplicaria el resultado y la vista quedaria en
  // "Confirmando tu correo..." para siempre.
  //
  // Con la promesa en el ref, la operacion logica de confirmacion se
  // inicia UNA SOLA VEZ (solo la primera ejecucion la crea), pero CADA
  // ejecucion del efecto adjunta su propio manejador con su propia
  // variable "cancelado" local. La limpieza de una ejecucion solo
  // cancela el manejador de esa ejecucion, nunca el de la vigente.
  const promesaConfirmacion = useRef<Promise<ResultadoConfirmacion> | null>(null);

  useEffect(() => {
    let cancelado = false;

    if (!promesaConfirmacion.current) {
      const supabase = obtenerClienteSupabase();
      promesaConfirmacion.current = ejecutarConfirmacion({
        initialize: () => supabase.auth.initialize(),
        getSession: () => supabase.auth.getSession(),
      });
    }

    promesaConfirmacion.current.then((resultado) => {
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
