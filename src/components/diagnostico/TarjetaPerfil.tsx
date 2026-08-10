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

      <Link
        href="/"
        className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
      >
        Volver al inicio
      </Link>
    </div>
  );
}
