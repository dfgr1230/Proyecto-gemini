import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Cliente publico del navegador -- SIEMPRE la Publishable key
// (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY), nunca service_role. Singleton
// perezoso: no lee variables de entorno ni se conecta a nada en el
// momento de importar el modulo, solo cuando algo realmente lo pide.
let instancia: SupabaseClient | null = null;

export function obtenerClienteSupabase(): SupabaseClient {
  if (instancia) return instancia;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clave = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !clave) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL y/o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY en las variables de entorno.'
    );
  }

  // persistSession: true (a diferencia de los scripts de checkpoint, que
  // usan false a proposito por ser procesos de un solo uso) -- aqui es
  // una aplicacion web real: la sesion del usuario debe sobrevivir a
  // recargas de pagina.
  instancia = createClient(url, clave, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return instancia;
}
