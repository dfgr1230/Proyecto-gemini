import type { Metadata } from 'next';
import FormularioDiagnostico from '@/components/diagnostico/FormularioDiagnostico';

export const metadata: Metadata = {
  title: 'Test de diagnóstico',
};

export default function PaginaDiagnostico() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <FormularioDiagnostico />
    </div>
  );
}
