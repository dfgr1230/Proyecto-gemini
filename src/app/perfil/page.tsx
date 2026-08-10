import type { Metadata } from 'next';
import VistaPerfil from '@/components/diagnostico/VistaPerfil';

export const metadata: Metadata = {
  title: 'Mi perfil de aprendizaje',
};

export default function PaginaPerfil() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <VistaPerfil />
    </div>
  );
}
