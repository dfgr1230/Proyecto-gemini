import type { Metadata } from 'next';
import FormularioLogin from '@/components/auth/FormularioLogin';

export const metadata: Metadata = {
  title: 'Iniciar sesión',
};

export default function PaginaLogin() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <FormularioLogin />
    </div>
  );
}
