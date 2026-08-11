import type { Metadata } from 'next';
import VistaCiclo from '@/components/ciclo/VistaCiclo';

export const metadata: Metadata = {
  title: 'Ciclo adaptativo',
};

export default function PaginaCiclo() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <VistaCiclo />
    </div>
  );
}
