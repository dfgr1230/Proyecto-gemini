import type { Metadata } from 'next';
import VistaActividad from '@/components/actividad/VistaActividad';

export const metadata: Metadata = {
  title: 'Mi actividad',
};

export default function PaginaActividad() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <VistaActividad />
    </div>
  );
}
