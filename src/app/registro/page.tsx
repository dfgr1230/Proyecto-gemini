import type { Metadata } from 'next';
import FormularioRegistro from '@/components/auth/FormularioRegistro';

export const metadata: Metadata = {
  title: 'Crear cuenta',
};

export default function PaginaRegistro() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <FormularioRegistro />
    </div>
  );
}
