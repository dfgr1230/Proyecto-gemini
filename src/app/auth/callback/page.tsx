import type { Metadata } from 'next';
import ConfirmacionCorreo from '@/components/auth/ConfirmacionCorreo';

export const metadata: Metadata = {
  title: 'Confirmando cuenta',
};

export default function PaginaCallbackAuth() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <ConfirmacionCorreo />
    </div>
  );
}
