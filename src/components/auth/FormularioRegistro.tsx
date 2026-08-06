'use client';

import { useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { obtenerClienteSupabase } from '@/lib/supabase/client';
import {
  ejecutarRegistro,
  type DatosRegistro,
  type ErroresRegistro,
} from '@/lib/auth/contrato';

type EstadoRegistro = 'inicial' | 'enviando' | 'confirmar_correo' | 'sesion_iniciada' | 'error';

const CAMPOS_EN_ORDEN = ['nombre', 'email', 'password', 'confirmarPassword'] as const;

export default function FormularioRegistro() {
  const [datos, setDatos] = useState<DatosRegistro>({
    nombre: '',
    email: '',
    password: '',
    confirmarPassword: '',
  });
  const [errores, setErrores] = useState<ErroresRegistro>({});
  const [estado, setEstado] = useState<EstadoRegistro>('inicial');
  const [mensajeError, setMensajeError] = useState<string | null>(null);

  const refNombre = useRef<HTMLInputElement>(null);
  const refEmail = useRef<HTMLInputElement>(null);
  const refPassword = useRef<HTMLInputElement>(null);
  const refConfirmar = useRef<HTMLInputElement>(null);
  const refsPorCampo = {
    nombre: refNombre,
    email: refEmail,
    password: refPassword,
    confirmarPassword: refConfirmar,
  };

  const enviando = estado === 'enviando';

  function actualizarCampo(campo: keyof DatosRegistro, valor: string) {
    setDatos((prev) => ({ ...prev, [campo]: valor }));
  }

  async function manejarEnvio(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return; // proteccion adicional contra doble envio

    setEstado('enviando');
    setMensajeError(null);

    const supabase = obtenerClienteSupabase();
    const emailRedirectTo = typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : undefined;

    const resultado = await ejecutarRegistro(datos, emailRedirectTo, {
      signUp: (carga) => supabase.auth.signUp(carga),
    });

    switch (resultado.estado) {
      case 'validacion_fallida': {
        setErrores(resultado.errores);
        setEstado('inicial');
        const primerCampoConError = CAMPOS_EN_ORDEN.find((campo) => resultado.errores[campo]);
        if (primerCampoConError) refsPorCampo[primerCampoConError].current?.focus();
        return;
      }
      case 'confirmar_correo':
        setErrores({});
        setEstado('confirmar_correo');
        return;
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

  if (estado === 'confirmar_correo') {
    return (
      <div
        role="status"
        className="w-full max-w-sm rounded-lg border border-black/[.08] bg-white p-8 text-center dark:border-white/[.145] dark:bg-zinc-950"
      >
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Revisa tu correo</h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          La cuenta fue creada correctamente. Revisa tu correo para confirmar la cuenta antes de iniciar sesión.
        </p>
      </div>
    );
  }

  if (estado === 'sesion_iniciada') {
    return (
      <div
        role="status"
        className="w-full max-w-sm rounded-lg border border-black/[.08] bg-white p-8 text-center dark:border-white/[.145] dark:bg-zinc-950"
      >
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Cuenta creada</h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          La cuenta fue creada correctamente y tu sesión quedó iniciada.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={manejarEnvio}
      noValidate
      className="w-full max-w-sm rounded-lg border border-black/[.08] bg-white p-8 dark:border-white/[.145] dark:bg-zinc-950"
    >
      <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Crear una cuenta</h1>

      <div className="mt-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="registro-nombre" className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Nombre
          </label>
          <input
            ref={refNombre}
            id="registro-nombre"
            name="nombre"
            type="text"
            autoComplete="name"
            value={datos.nombre}
            onChange={(e) => actualizarCampo('nombre', e.target.value)}
            disabled={enviando}
            aria-invalid={Boolean(errores.nombre)}
            aria-describedby={errores.nombre ? 'registro-nombre-error' : undefined}
            className="rounded-md border border-black/[.08] bg-white px-3 py-2 text-sm text-zinc-950 disabled:opacity-60 dark:border-white/[.145] dark:bg-black dark:text-zinc-50"
          />
          {errores.nombre && (
            <p id="registro-nombre-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
              {errores.nombre}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="registro-email" className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Correo electrónico
          </label>
          <input
            ref={refEmail}
            id="registro-email"
            name="email"
            type="email"
            autoComplete="email"
            value={datos.email}
            onChange={(e) => actualizarCampo('email', e.target.value)}
            disabled={enviando}
            aria-invalid={Boolean(errores.email)}
            aria-describedby={errores.email ? 'registro-email-error' : undefined}
            className="rounded-md border border-black/[.08] bg-white px-3 py-2 text-sm text-zinc-950 disabled:opacity-60 dark:border-white/[.145] dark:bg-black dark:text-zinc-50"
          />
          {errores.email && (
            <p id="registro-email-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
              {errores.email}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="registro-password" className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Contraseña
          </label>
          <input
            ref={refPassword}
            id="registro-password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={datos.password}
            onChange={(e) => actualizarCampo('password', e.target.value)}
            disabled={enviando}
            aria-invalid={Boolean(errores.password)}
            aria-describedby={errores.password ? 'registro-password-error' : undefined}
            className="rounded-md border border-black/[.08] bg-white px-3 py-2 text-sm text-zinc-950 disabled:opacity-60 dark:border-white/[.145] dark:bg-black dark:text-zinc-50"
          />
          {errores.password && (
            <p id="registro-password-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
              {errores.password}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="registro-confirmar" className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Confirmar contraseña
          </label>
          <input
            ref={refConfirmar}
            id="registro-confirmar"
            name="confirmarPassword"
            type="password"
            autoComplete="new-password"
            value={datos.confirmarPassword}
            onChange={(e) => actualizarCampo('confirmarPassword', e.target.value)}
            disabled={enviando}
            aria-invalid={Boolean(errores.confirmarPassword)}
            aria-describedby={errores.confirmarPassword ? 'registro-confirmar-error' : undefined}
            className="rounded-md border border-black/[.08] bg-white px-3 py-2 text-sm text-zinc-950 disabled:opacity-60 dark:border-white/[.145] dark:bg-black dark:text-zinc-50"
          />
          {errores.confirmarPassword && (
            <p id="registro-confirmar-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
              {errores.confirmarPassword}
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
          {enviando ? 'Creando cuenta…' : 'Crear cuenta'}
        </button>

        <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
          ¿Ya tienes cuenta?{' '}
          <Link href="/login" className="font-medium text-zinc-950 underline dark:text-zinc-50">
            Inicia sesión
          </Link>
        </p>
      </div>
    </form>
  );
}
