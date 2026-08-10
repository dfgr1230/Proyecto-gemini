// Ruta de servidor: genera el perfil educativo con Gemini y lo persiste.
//
// Es el UNICO punto del sistema donde se usa GEMINI_API_KEY. Al vivir en
// una ruta de API (codigo de servidor), ni la clave ni el prompt llegan
// nunca al navegador: lo que viaja de vuelta es exclusivamente el perfil
// ya validado, o un codigo de error de un conjunto cerrado.
//
// Orden deliberado de las operaciones:
//   1. autenticar     -> sin identidad verificada no se hace nada mas;
//   2. validar entrada;
//   3. generar perfil con Gemini;
//   4. validar el perfil;
//   5. persistir SOLO si todo lo anterior fue valido.
// Persistir al final es lo que permite reintentar sin consumir el unico
// diagnostico que el esquema admite por usuario (usuario_id es UNIQUE en
// public.diagnosticos, y no hay policy de DELETE).

import { NextResponse } from 'next/server';
import { validarRespuestasDiagnostico } from '@/lib/diagnostico/contrato';
import { generarPerfil } from '@/lib/gemini/perfil';
import { llamarGemini } from '@/lib/gemini/cliente';
import {
  crearClienteConToken,
  extraerTokenBearer,
  interpretarResultadoPersistencia,
  verificarUsuario,
} from '@/lib/supabase/servidor';

// Conjunto cerrado de codigos de error. El cliente decide el texto a
// mostrar; el servidor nunca envia mensajes crudos de Gemini, Supabase ni
// Postgres, ni detalles internos de ningun tipo.
type CodigoError =
  | 'sin_sesion'
  | 'respuestas_invalidas'
  | 'peticion_invalida'
  | 'perfil_no_disponible'
  | 'no_persistido'
  | 'diagnostico_existente';

function error(codigo: CodigoError, estadoHttp: number) {
  return NextResponse.json({ ok: false, codigo }, { status: estadoHttp });
}

export async function POST(peticion: Request) {
  // --- 1. Identidad verificada en servidor ---
  const token = extraerTokenBearer(peticion.headers.get('authorization'));
  if (!token) return error('sin_sesion', 401);

  const supabase = crearClienteConToken(token);
  const usuario = await verificarUsuario(token, {
    getUser: (jwt) => supabase.auth.getUser(jwt),
  });
  if (usuario.estado === 'sin_sesion') return error('sin_sesion', 401);

  // --- 2. Entrada ---
  let cuerpo: unknown;
  try {
    cuerpo = await peticion.json();
  } catch {
    return error('peticion_invalida', 400);
  }

  if (cuerpo === null || typeof cuerpo !== 'object') {
    return error('peticion_invalida', 400);
  }

  // El "usuario_id" NO se lee del cuerpo aunque el cliente lo enviara:
  // la identidad viene solo de la verificacion del token, y dentro de la
  // base de datos, de auth.uid().
  const validacion = validarRespuestasDiagnostico((cuerpo as { respuestas?: unknown }).respuestas);
  if (!validacion.valido) return error('respuestas_invalidas', 400);

  // --- 3 y 4. Perfil generado y validado ---
  const resultado = await generarPerfil(validacion.respuestas, { llamar: llamarGemini });
  if (resultado.estado === 'error') {
    // Todas las categorias (configuracion, red, proveedor, respuesta
    // invalida) colapsan en un unico codigo hacia el cliente: distinguirlas
    // filtraria informacion sobre la infraestructura sin ayudar al usuario,
    // cuya accion es la misma en todos los casos -- reintentar.
    return error('perfil_no_disponible', 502);
  }

  // --- 5. Persistencia atomica, solo con un perfil valido ---
  const respuestaRpc = await supabase.rpc('guardar_diagnostico_con_perfil', {
    p_respuestas: validacion.respuestas,
    p_perfil: resultado.perfil,
  });

  const persistencia = interpretarResultadoPersistencia(respuestaRpc);
  if (persistencia === 'diagnostico_existente') return error('diagnostico_existente', 409);
  if (persistencia === 'no_persistido') return error('no_persistido', 500);

  // Solo aqui se declara exito: perfil valido Y persistencia confirmada.
  // Se devuelve exclusivamente el perfil ya validado -- ninguna traza del
  // prompt, del proveedor ni de la configuracion del servidor.
  return NextResponse.json({ ok: true, perfil: resultado.perfil }, { status: 200 });
}
