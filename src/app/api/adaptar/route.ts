// Ruta de servidor del CICLO ADAPTATIVO.
//
// Una respuesta del estudiante entra aqui y salen: el intento registrado
// por PostgreSQL, el analisis educativo decidido por Gemini y la
// siguiente actividad elegida con esa recomendacion.
//
// Junto con /api/perfil, es uno de los dos unicos puntos del sistema
// donde se usa GEMINI_API_KEY. Al vivir en una ruta de API (codigo de
// servidor), ni la clave ni el prompt llegan nunca al navegador: lo que
// viaja de vuelta es exclusivamente el analisis ya validado, o un codigo
// de error de un conjunto cerrado.
//
// La orquestacion completa vive en src/lib/adaptativo/ciclo.ts para poder
// probarse sin red ni base de datos; este archivo solo ata las
// dependencias reales.

import { NextResponse } from 'next/server';
import { consultarPerfilPropio } from '@/lib/diagnostico/consulta';
import { generarAnalisisAdaptativo } from '@/lib/adaptativo/analisis';
import { ejecutarCicloAdaptativo, type CodigoErrorCiclo } from '@/lib/adaptativo/ciclo';
import { type ParametrosAnalisis } from '@/lib/adaptativo/persistencia';
import { llamarGemini } from '@/lib/gemini/cliente';
import { crearClienteConToken, extraerTokenBearer, verificarUsuario } from '@/lib/supabase/servidor';
import { conservarAnalisisConCredencialDeServidor } from '@/lib/supabase/servidorPrivilegiado';

type CodigoError = 'sin_sesion' | 'peticion_invalida' | CodigoErrorCiclo;

// Cada codigo del ciclo se traduce a un estado HTTP con un criterio
// unico: 4xx cuando la peticion o el estado del usuario deben cambiar,
// 5xx cuando el fallo es del servidor o de un servicio externo.
const ESTADO_HTTP: Record<CodigoErrorCiclo, number> = {
  sin_perfil: 409,
  perfil_incompleto: 409,
  lectura_fallida: 500,
  ejercicio_desconocido: 400,
  respuesta_invalida: 400,
  intento_no_registrado: 500,
  analisis_no_disponible: 502,
};

function error(codigo: CodigoError, estadoHttp: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, codigo, ...extra }, { status: estadoHttp });
}

const TIEMPO_MAXIMO_SEGUNDOS = 3600;

// Normaliza el tiempo declarado por el navegador. Es un dato de
// comodidad, no una medida de confianza: se acota al rango que admite el
// CHECK de public.intentos y cualquier valor extrano se convierte en
// null en vez de hacer fallar toda la peticion.
function normalizarTiempo(valor: unknown): number | null {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return null;
  const entero = Math.round(valor);
  if (entero < 0) return null;
  return Math.min(TIEMPO_MAXIMO_SEGUNDOS, entero);
}

export async function POST(peticion: Request) {
  // --- Identidad verificada en servidor ---
  const token = extraerTokenBearer(peticion.headers.get('authorization'));
  if (!token) return error('sin_sesion', 401);

  const supabase = crearClienteConToken(token);
  const usuario = await verificarUsuario(token, {
    getUser: (jwt) => supabase.auth.getUser(jwt),
  });
  if (usuario.estado === 'sin_sesion') return error('sin_sesion', 401);

  // --- Entrada ---
  let cuerpo: unknown;
  try {
    cuerpo = await peticion.json();
  } catch {
    return error('peticion_invalida', 400);
  }
  if (cuerpo === null || typeof cuerpo !== 'object') return error('peticion_invalida', 400);

  const c = cuerpo as Record<string, unknown>;
  if (typeof c.ejercicio_id !== 'string' || typeof c.respuesta_dada !== 'string') {
    return error('peticion_invalida', 400);
  }

  // El "usuario_id" NO se lee del cuerpo aunque el cliente lo enviara: la
  // identidad viene solo de la verificacion del token y, dentro de la
  // base de datos, de auth.uid(). Ninguna de las consultas de abajo
  // filtra por un identificador enviado por el navegador -- quien
  // restringe las filas es RLS.
  const resultado = await ejecutarCicloAdaptativo(
    {
      ejercicioId: c.ejercicio_id,
      respuestaDada: c.respuesta_dada,
      tiempoRespuesta: normalizarTiempo(c.tiempo_respuesta),
    },
    {
      leerPerfil: () =>
        consultarPerfilPropio({
          seleccionar: () => supabase.from('diagnosticos').select('perfil_detectado').limit(1),
        }),
      leerEjercicios: async () => {
        const r = await supabase.from('ejercicios').select('id,materia,nivel_dificultad,contenido');
        return { data: r.data, error: r.error };
      },
      leerIntentos: async () => {
        const r = await supabase
          .from('intentos')
          .select('id,ejercicio_id,correcto,fecha,tiempo_respuesta,respuesta_dada');
        return { data: r.data, error: r.error };
      },
      // Ultimo analisis conservado. El orden y el limite se resuelven en
      // la base de datos; RLS decide que filas son visibles.
      //
      // Se ordena por "version" (columna IDENTITY) y NO por "fecha":
      // fecha usa now(), que devuelve el instante de INICIO de la
      // transaccion, de modo que dos filas pueden compartir marca de
      // tiempo y "el ultimo analisis" quedaria indefinido.
      //
      // Lo que aporta version es un orden DETERMINISTA DE ASIGNACION: dos
      // filas nunca comparten valor, asi que "la mayor" siempre tiene una
      // respuesta unica. NO es el orden de finalizacion de transacciones
      // concurrentes ni una numeracion sin huecos. Basta aqui porque el
      // ciclo es secuencial por construccion: no hay segunda respuesta
      // hasta que la primera devuelve su analisis.
      leerAnalisisVigente: async () => {
        const r = await supabase
          .from('analisis_adaptativos')
          .select('analisis')
          .order('version', { ascending: false })
          .limit(1);
        return { data: r.data, error: r.error };
      },
      registrarIntento: async (parametros) => {
        const r = await supabase.rpc('registrar_intento', parametros);
        return { data: r.data, error: r.error };
      },
      // UNICA operacion del ciclo que NO usa el cliente atado al token del
      // usuario. La RPC de conservacion ya no esta concedida a anon ni a
      // authenticated: el navegador no puede invocarla aunque lo intente
      // desde la consola, de modo que un analisis solo puede entrar por
      // aqui -- despues de verificar la sesion y despues de que Gemini
      // haya devuelto una respuesta real y validada.
      //
      // El resto del ciclo (perfil, banco, historial y registrar_intento)
      // sigue con la identidad del propio estudiante: las respuestas y
      // calificaciones originales se siguen escribiendo bajo RLS, no con
      // una credencial de servidor.
      conservarAnalisis: (parametros: ParametrosAnalisis) =>
        conservarAnalisisConCredencialDeServidor(parametros),
      analizar: (contexto) => generarAnalisisAdaptativo(contexto, { llamar: llamarGemini }),
    }
  );

  if (resultado.estado === 'error') {
    // El intento se informa junto al fallo solo cuando SI quedo
    // registrado: es lo que permite a la interfaz decir "tu respuesta se
    // guardó, el análisis no está disponible" en vez de dar a entender
    // que se perdio todo, o de fingir que hubo adaptacion.
    const extra = resultado.intento === null ? {} : { intento: resultado.intento };
    return error(resultado.codigo, ESTADO_HTTP[resultado.codigo], extra);
  }

  // Traza de servidor con la evidencia de la llamada real a Gemini. No
  // incluye la clave, el prompt, las respuestas del estudiante ni el
  // texto generado -- solo modelo, duracion y forma de la respuesta.
  if (resultado.metadatos !== null) {
    console.info(
      `[ciclo] iteracion=${resultado.iteracion} modelo=${resultado.metadatos.modelo} ` +
        `ms=${resultado.metadatos.duracion_ms} fin=${resultado.metadatos.motivo_finalizacion ?? '?'} ` +
        `chars=${resultado.metadatos.caracteres_respuesta} conservacion=${resultado.conservacion}`
    );
  }

  return NextResponse.json(
    {
      ok: true,
      iteracion: resultado.iteracion,
      intento: resultado.intento,
      analisis: resultado.analisis,
      // Se devuelve el analisis anterior para que la interfaz pueda
      // mostrar QUE cambio entre iteraciones. Es la evidencia visible de
      // que el ciclo es acumulativo y no una lectura aislada.
      analisis_previo: resultado.analisisPrevio,
      conservacion: resultado.conservacion,
      siguiente: resultado.siguiente,
      // Metadatos no sensibles de la llamada real, para poder demostrar
      // ante el jurado que la decision la tomo el modelo.
      ia: resultado.metadatos,
    },
    { status: 200 }
  );
}
