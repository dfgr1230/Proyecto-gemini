'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { obtenerClienteSupabase } from '@/lib/supabase/client';
import { ejecutarLogout, verificarSesionProtegida } from '@/lib/auth/contrato';
import { consultarPerfilPropio } from '@/lib/diagnostico/consulta';

type EstadoVista = 'cargando' | 'redirigiendo' | 'autenticado';
type EstadoLogout = 'inicial' | 'cerrando' | 'error';

// Contenido protegido minimo de "/". La proteccion es del lado del
// cliente (verifica la sesion ya presente en el SDK de Supabase, sin
// SSR ni middleware nuevo) -- es una capa de UX, no de seguridad: los
// datos reales siguen protegidos por las politicas RLS existentes,
// sin cambios.
export default function VistaProtegida() {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoVista>('cargando');
  const [estadoLogout, setEstadoLogout] = useState<EstadoLogout>('inicial');
  const [mensajeErrorLogout, setMensajeErrorLogout] = useState<string | null>(null);
  // null mientras no se sabe. Determina si el unico boton de accion
  // ofrece hacer el test o ver el perfil ya generado: mostrar "hacer el
  // test" a quien ya lo hizo lleva a una redireccion inmediata que se
  // percibe como un fallo.
  const [tieneDiagnostico, setTieneDiagnostico] = useState<boolean | null>(null);

  // Sin guardia de "ya se ejecuto una vez" (a proposito -- ver nota mas
  // abajo): en Strict Mode, React ejecuta este efecto, invoca de
  // inmediato la limpieza que devuelve, y lo vuelve a ejecutar
  // (montaje -> limpieza -> nuevo montaje) antes de que la promesa de
  // la primera ejecucion se resuelva. Una guardia que ponga una
  // bandera en useRef a "ya verificado" en la PRIMERA ejecucion hace
  // que la SEGUNDA se salte por completo (la bandera ya esta en true),
  // asi que el unico manejador de resultado que llegaria a existir es
  // el de la primera ejecucion -- pero esa primera ejecucion ya fue
  // cancelada por su propia limpieza (cancelado = true) antes de que
  // la promesa resolviera. Resultado: ninguna de las dos ejecuciones
  // aplica el resultado, y la vista queda en "Cargando..." para
  // siempre.
  //
  // La correccion es dejar que el efecto se ejecute las veces que
  // React decida (no es mutante: getSession() es una lectura). Cada
  // ejecucion tiene su PROPIA variable "cancelado" en su propio
  // closure. La limpieza de la primera ejecucion solo cancela la
  // bandera de esa primera ejecucion, nunca la de la segunda -- asi
  // que la ejecucion vigente (la segunda, en Strict Mode; la unica, en
  // produccion) siempre conserva un manejador activo capaz de aplicar
  // el resultado.
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
      setEstado('autenticado');

      // Consulta secundaria: solo decide la etiqueta del boton, asi que
      // no bloquea la vista ni la invalida si falla. Ante un error se
      // deja el valor conservador (todavia no hay diagnostico), y la
      // propia ruta /diagnostico corregira el destino si hace falta.
      const consulta = await consultarPerfilPropio({
        seleccionar: () => supabase.from('diagnosticos').select('perfil_detectado').limit(1),
      });
      if (cancelado) return;
      setTieneDiagnostico(consulta.estado !== 'sin_diagnostico' && consulta.estado !== 'error');
    }

    cargar();

    return () => {
      cancelado = true;
    };
  }, [router]);

  async function manejarLogout() {
    if (estadoLogout === 'cerrando') return; // proteccion adicional contra doble envio

    setEstadoLogout('cerrando');
    setMensajeErrorLogout(null);

    const supabase = obtenerClienteSupabase();
    const resultado = await ejecutarLogout({
      signOut: () => supabase.auth.signOut(),
    });

    if (resultado.estado === 'error') {
      // El logout fallo: la sesion sigue activa. No se navega ni se
      // finge un cierre de sesion que no ocurrio.
      setEstadoLogout('error');
      setMensajeErrorLogout(resultado.mensaje);
      return;
    }

    // signOut() ya invalido la sesion en el cliente de Supabase (borra
    // el token persistido); replace() ademas evita que el boton "atras"
    // del navegador vuelva a mostrar este contenido protegido.
    setEstado('redirigiendo');
    router.replace('/login');
  }

  if (estado === 'cargando' || estado === 'redirigiendo') {
    return (
      <div
        role="status"
        className="w-full max-w-sm rounded-lg border border-black/[.08] bg-white p-8 text-center dark:border-white/[.145] dark:bg-zinc-950"
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Cargando…</p>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="w-full max-w-sm rounded-lg border border-black/[.08] bg-white p-8 text-center dark:border-white/[.145] dark:bg-zinc-950"
    >
      <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Sesión iniciada</h1>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">Tu sesión está activa.</p>

      {mensajeErrorLogout && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {mensajeErrorLogout}
        </p>
      )}

      {/* Unico punto de entrada, contextual segun exista o no perfil.
          Mientras se resuelve la consulta no se dibuja ningun boton, para
          no mostrar una etiqueta que cambie sola bajo el cursor. */}
      {tieneDiagnostico !== null && (
        <Link
          href={tieneDiagnostico ? '/perfil' : '/diagnostico'}
          className="mt-6 flex h-11 w-full items-center justify-center rounded-full bg-foreground text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
        >
          {tieneDiagnostico ? 'Ver mi perfil de aprendizaje' : 'Hacer el test de diagnóstico'}
        </Link>
      )}

      <button
        type="button"
        onClick={manejarLogout}
        disabled={estadoLogout === 'cerrando'}
        aria-busy={estadoLogout === 'cerrando'}
        className="mt-6 flex h-11 w-full items-center justify-center rounded-full bg-foreground text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-[#ccc]"
      >
        {estadoLogout === 'cerrando' ? 'Cerrando sesión…' : 'Cerrar sesión'}
      </button>
    </div>
  );
}
