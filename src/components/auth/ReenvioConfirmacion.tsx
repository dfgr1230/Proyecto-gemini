'use client';

import { useRef, useState, type FormEvent } from 'react';
import { obtenerClienteSupabase } from '@/lib/supabase/client';
import { ejecutarReenvio, validarEmail } from '@/lib/auth/contrato';

type EstadoReenvio = 'inicial' | 'enviando' | 'enviado' | 'limite_frecuencia' | 'error_red';

const MENSAJE_NEUTRAL =
  'Si la cuenta está pendiente de confirmación, recibirás un nuevo correo. Revisa también la carpeta de spam.';

interface Props {
  emailInicial?: string;
}

export default function ReenvioConfirmacion({ emailInicial }: Props) {
  const [visible, setVisible] = useState(false);
  const [email, setEmail] = useState(emailInicial ?? '');
  const [errorLocal, setErrorLocal] = useState<string | undefined>(undefined);
  const [estado, setEstado] = useState<EstadoReenvio>('inicial');
  const [mensaje, setMensaje] = useState<string | null>(null);

  const refEmail = useRef<HTMLInputElement>(null);

  const enviando = estado === 'enviando';

  async function manejarEnvio(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return; // proteccion adicional contra doble envio

    setEstado('enviando');
    setMensaje(null);

    const supabase = obtenerClienteSupabase();
    const emailRedirectTo = `${window.location.origin}/auth/callback`;

    const resultado = await ejecutarReenvio(email, emailRedirectTo, {
      resend: (carga) => supabase.auth.resend(carga),
    });

    switch (resultado.estado) {
      case 'email_invalido':
        setErrorLocal(resultado.error);
        setEstado('inicial');
        refEmail.current?.focus();
        return;
      case 'solicitud_procesada':
        setErrorLocal(undefined);
        setMensaje(MENSAJE_NEUTRAL);
        setEstado('enviado');
        return;
      case 'limite_frecuencia':
        setErrorLocal(undefined);
        setMensaje(resultado.mensaje);
        setEstado('limite_frecuencia');
        return;
      case 'error_red':
        setErrorLocal(undefined);
        setMensaje(resultado.mensaje);
        setEstado('error_red');
        return;
    }
  }

  if (!visible) {
    return (
      <button
        type="button"
        onClick={() => setVisible(true)}
        className="text-sm text-zinc-600 underline underline-offset-2 dark:text-zinc-400"
      >
        ¿No confirmaste tu cuenta? Reenviar correo de confirmación
      </button>
    );
  }

  return (
    <form
      onSubmit={manejarEnvio}
      noValidate
      className="w-full max-w-sm rounded-lg border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-zinc-950"
    >
      <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Reenviar correo de confirmación</h2>

      <div className="mt-3 flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reenvio-email" className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Correo electrónico
          </label>
          <input
            ref={refEmail}
            id="reenvio-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (errorLocal && validarEmail(e.target.value) === undefined) setErrorLocal(undefined);
            }}
            disabled={enviando}
            aria-invalid={Boolean(errorLocal)}
            aria-describedby={errorLocal ? 'reenvio-email-error' : undefined}
            className="rounded-md border border-black/[.08] bg-white px-3 py-2 text-sm text-zinc-950 disabled:opacity-60 dark:border-white/[.145] dark:bg-black dark:text-zinc-50"
          />
          {errorLocal && (
            <p id="reenvio-email-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
              {errorLocal}
            </p>
          )}
        </div>

        {estado === 'enviado' && mensaje && (
          <p role="status" aria-live="polite" className="text-sm text-zinc-700 dark:text-zinc-300">
            {mensaje}
          </p>
        )}

        {(estado === 'limite_frecuencia' || estado === 'error_red') && mensaje && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {mensaje}
          </p>
        )}

        <button
          type="submit"
          disabled={enviando}
          aria-busy={enviando}
          className="flex h-10 w-full items-center justify-center rounded-full border border-black/[.08] text-sm font-medium text-zinc-950 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/[.145] dark:text-zinc-50 dark:hover:bg-zinc-900"
        >
          {enviando ? 'Enviando…' : 'Reenviar correo de confirmación'}
        </button>
      </div>
    </form>
  );
}
