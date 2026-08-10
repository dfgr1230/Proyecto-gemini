'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { obtenerClienteSupabase } from '@/lib/supabase/client';
import { verificarSesionProtegida } from '@/lib/auth/contrato';
import {
  consultarPerfilPropio,
  MENSAJE_ERROR_CONSULTA,
  MENSAJE_PERFIL_INCOMPLETO,
  type ResultadoConsultaPerfil,
} from '@/lib/diagnostico/consulta';
import TarjetaPerfil from './TarjetaPerfil';

type EstadoVista = 'cargando' | 'redirigiendo' | 'listo';

// Vista del perfil ya persistido. A diferencia del formulario, aqui NO se
// genera nada: se lee lo que ya existe. Por eso sobrevive a una recarga y
// a un cierre de sesion -- el perfil vive en la base de datos, no en el
// estado de React.
export default function VistaPerfil() {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoVista>('cargando');
  const [resultado, setResultado] = useState<ResultadoConsultaPerfil | null>(null);

  // Misma disciplina de cancelacion que VistaProtegida y
  // FormularioDiagnostico: cada ejecucion del efecto conserva su propia
  // bandera local, de modo que bajo Strict Mode la ejecucion vigente
  // siempre mantiene un manejador activo.
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

      // Sin filtro por usuario: lo impone la policy RLS
      // diagnosticos_select_propio. limit(1) porque usuario_id es UNIQUE.
      const consulta = await consultarPerfilPropio({
        seleccionar: () =>
          supabase.from('diagnosticos').select('perfil_detectado').limit(1),
      });
      if (cancelado) return;

      if (consulta.estado === 'sin_diagnostico') {
        setEstado('redirigiendo');
        router.replace('/diagnostico');
        return;
      }

      setResultado(consulta);
      setEstado('listo');
    }

    cargar();

    return () => {
      cancelado = true;
    };
  }, [router]);

  if (estado !== 'listo' || resultado === null) {
    return (
      <div
        role="status"
        className="w-full max-w-2xl rounded-lg border border-black/[.08] bg-white p-8 text-center dark:border-white/[.145] dark:bg-zinc-950"
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Cargando…</p>
      </div>
    );
  }

  if (resultado.estado === 'con_perfil') {
    return <TarjetaPerfil perfil={resultado.perfil} />;
  }

  // 'perfil_incompleto' y 'error'. Ninguno de los dos ofrece "reintentar
  // el test": el diagnostico es unico por usuario y repetirlo no es una
  // accion disponible.
  return (
    <div
      role="alert"
      className="w-full max-w-2xl rounded-lg border border-black/[.08] bg-white p-8 text-center dark:border-white/[.145] dark:bg-zinc-950"
    >
      <p className="text-sm text-zinc-800 dark:text-zinc-200">
        {resultado.estado === 'perfil_incompleto'
          ? MENSAJE_PERFIL_INCOMPLETO
          : MENSAJE_ERROR_CONSULTA}
      </p>
    </div>
  );
}
