'use client';

import { useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { obtenerClienteSupabase } from '@/lib/supabase/client';
import { ejecutarLogin, type DatosLogin, type ErroresLogin } from '@/lib/auth/contrato';
import ReenvioConfirmacion from './ReenvioConfirmacion';

type EstadoLogin = 'inicial' | 'enviando' | 'sesion_iniciada' | 'error';

export default function FormularioLogin() {
  const [datos, setDatos] = useState<DatosLogin>({ email: '', password: '' });
  const [errores, setErrores] = useState<ErroresLogin>({});
  const [estado, setEstado] = useState<EstadoLogin>('inicial');
  const [mensajeError, setMensajeError] = useState<string | null>(null);

  const refEmail = useRef<HTMLInputElement>(null);
  const refPassword = useRef<HTMLInputElement>(null);

  const enviando = estado === 'enviando';

  function actualizarCampo(campo: keyof DatosLogin, valor: string) {
    setDatos((prev) => ({ ...prev, [campo]: valor }));
  }

  async function manejarEnvio(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return; // proteccion adicional contra doble envio

    setEstado('enviando');
    setMensajeError(null);

    const supabase = obtenerClienteSupabase();
    const resultado = await ejecutarLogin(datos, {
      signInWithPassword: (credenciales) => supabase.auth.signInWithPassword(credenciales),
    });

    switch (resultado.estado) {
      case 'validacion_fallida': {
        setErrores(resultado.errores);
        setEstado('inicial');
        if (resultado.errores.email) refEmail.current?.focus();
        else if (resultado.errores.password) refPassword.current?.focus();
        return;
      }
      case 'sesion_iniciada':
        setErrores({});
        setEstado('sesion_iniciada');
        return;
      case 'error':
        setMensajeError(resultado.mensaje);
        setEstado('error');
        return;
    }
  }

  if (estado === 'sesion_iniciada') {
    return (
      <div
        role="status"
        className="w-full max-w-sm rounded-lg border border-black/[.08] bg-white p-8 text-center dark:border-white/[.145] dark:bg-zinc-950"
      >
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Sesión iniciada</h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">Tu sesión se inició correctamente.</p>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <form
        onSubmit={manejarEnvio}
        noValidate
        className="w-full max-w-sm rounded-lg border border-black/[.08] bg-white p-8 dark:border-white/[.145] dark:bg-zinc-950"
      >
      <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Iniciar sesión</h1>

      <div className="mt-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="login-email" className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Correo electrónico
          </label>
          <input
            ref={refEmail}
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            value={datos.email}
            onChange={(e) => actualizarCampo('email', e.target.value)}
            disabled={enviando}
            aria-invalid={Boolean(errores.email)}
            aria-describedby={errores.email ? 'login-email-error' : undefined}
            className="rounded-md border border-black/[.08] bg-white px-3 py-2 text-sm text-zinc-950 disabled:opacity-60 dark:border-white/[.145] dark:bg-black dark:text-zinc-50"
          />
          {errores.email && (
            <p id="login-email-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
              {errores.email}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="login-password" className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Contraseña
          </label>
          <input
            ref={refPassword}
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={datos.password}
            onChange={(e) => actualizarCampo('password', e.target.value)}
            disabled={enviando}
            aria-invalid={Boolean(errores.password)}
            aria-describedby={errores.password ? 'login-password-error' : undefined}
            className="rounded-md border border-black/[.08] bg-white px-3 py-2 text-sm text-zinc-950 disabled:opacity-60 dark:border-white/[.145] dark:bg-black dark:text-zinc-50"
          />
          {errores.password && (
            <p id="login-password-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
              {errores.password}
            </p>
          )}
        </div>

        {mensajeError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {mensajeError}
          </p>
        )}

        <button
          type="submit"
          disabled={enviando}
          aria-busy={enviando}
          className="mt-2 flex h-11 w-full items-center justify-center rounded-full bg-foreground text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-[#ccc]"
        >
          {enviando ? 'Iniciando sesión…' : 'Iniciar sesión'}
        </button>

        <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
          ¿No tienes cuenta?{' '}
          <Link href="/registro" className="font-medium text-zinc-950 underline dark:text-zinc-50">
            Crear una cuenta
          </Link>
        </p>
      </div>
      </form>
      <ReenvioConfirmacion emailInicial={datos.email} />
    </div>
  );
}
