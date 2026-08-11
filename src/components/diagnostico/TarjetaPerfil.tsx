import Link from 'next/link';
import type { PerfilDetectado } from '@/lib/diagnostico/contrato';

// Presentacion del perfil, extraida de FormularioDiagnostico para que
// /perfil y el diagnostico muestren EXACTAMENTE lo mismo. Componente sin
// estado y sin efectos: no consulta, no navega, solo dibuja lo que recibe.

const ETIQUETA_ESTILO: Record<string, string> = {
  visual: 'Visual',
  auditivo: 'Auditivo',
  lectoescritor: 'Lectura y escritura',
  kinestesico: 'Práctico',
};

export default function TarjetaPerfil({ perfil }: { perfil: PerfilDetectado }) {
  return (
    <div
      role="status"
      className="w-full max-w-2xl rounded-lg border border-black/[.08] bg-white p-8 dark:border-white/[.145] dark:bg-zinc-950"
    >
      <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
        Tu orientación de aprendizaje
      </h1>

      <dl className="mt-6 flex flex-col gap-4">
        <div>
          <dt className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            Cómo aprendes mejor
          </dt>
          <dd className="text-base text-zinc-950 dark:text-zinc-50">
            {ETIQUETA_ESTILO[perfil.estilo_aprendizaje] ?? perfil.estilo_aprendizaje}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            Nivel inicial sugerido
          </dt>
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

      {/* Accion principal: el perfil no es el final del recorrido, es lo
          que decide la actividad siguiente.
          Se anaden DOS destinos porque son recorridos distintos y ambos
          siguen vigentes: /ciclo ejecuta el ciclo adaptativo completo con
          analisis de Gemini tras cada respuesta; /actividad conserva sin
          cambios la actividad unica con seleccion determinista. */}
      <Link
        href="/ciclo"
        className="mt-6 flex h-12 w-full items-center justify-center rounded-full bg-foreground text-base font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
      >
        Iniciar ciclo adaptativo
      </Link>

      <Link
        href="/actividad"
        className="mt-3 flex h-11 w-full items-center justify-center rounded-full border border-black/[.08] px-5 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 dark:border-white/[.145] dark:text-zinc-200 dark:hover:bg-zinc-900"
      >
        Iniciar actividad
      </Link>

      <Link
        href="/"
        className="mt-3 flex h-11 w-full items-center justify-center rounded-full border border-black/[.08] px-5 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 dark:border-white/[.145] dark:text-zinc-200 dark:hover:bg-zinc-900"
      >
        Volver al inicio
      </Link>
    </div>
  );
}
