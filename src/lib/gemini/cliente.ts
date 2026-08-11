// Cliente de Gemini -- EXCLUSIVAMENTE DE SERVIDOR.
//
// Este modulo NUNCA debe importarse desde un componente marcado con
// 'use client'. La clave se lee de process.env.GEMINI_API_KEY, una
// variable SIN el prefijo NEXT_PUBLIC_, por lo que Next.js no la incluye
// en el bundle del navegador: cualquier import accidental desde cliente
// haria que la variable llegara como undefined y la llamada fallara de
// forma ruidosa, en vez de filtrar el secreto.
//
// No se instalo ningun SDK: el proyecto no tiene dependencias de Google
// (ver package.json) y esta orden no autoriza instalar paquetes. Se usa
// fetch nativo contra la API REST oficial de Google AI Studio, que es
// suficiente para una sola llamada de generacion con salida estructurada.

// Guardia defensiva: si este modulo llegara a evaluarse en un navegador,
// se detiene antes de intentar leer nada del entorno.
if (typeof window !== 'undefined') {
  throw new Error('El cliente de Gemini es de servidor y no puede ejecutarse en el navegador.');
}

// Identificador del modelo centralizado en un unico punto. Puede
// sobrescribirse con la variable de entorno GEMINI_MODELO, que
// deliberadamente NO lleva el prefijo NEXT_PUBLIC_ (no debe viajar al
// navegador ni aparecer en el bundle).
// El valor anterior, 'gemini-2.5-flash', devolvia 404 NOT_FOUND con el
// mensaje "no longer available to new users": el modelo sigue apareciendo
// en el catalogo de /v1beta/models pero ya no acepta generateContent con
// claves creadas recientemente. Se sustituye por el flash estable mas
// reciente de los habilitados para esta clave. Se elige un nombre fijo y
// no un alias movil ('gemini-flash-latest') para que la version no cambie
// sola entre la grabacion del video y la revision del jurado.
export const MODELO_GEMINI_POR_DEFECTO = 'gemini-3.6-flash';

export function obtenerModeloGemini(): string {
  const configurado = process.env.GEMINI_MODELO?.trim();
  return configurado && configurado.length > 0 ? configurado : MODELO_GEMINI_POR_DEFECTO;
}

const BASE_API_GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';

// Esquema de respuesta que se le exige al modelo. Es el mismo contrato
// que valida src/lib/diagnostico/contrato.ts -- pedirlo aqui reduce la
// probabilidad de una respuesta mal formada, pero NO sustituye a la
// validacion posterior: la respuesta se vuelve a comprobar siempre.
export interface EsquemaRespuesta {
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
  propertyOrdering?: string[];
}

export interface PeticionGemini {
  instruccion: string;
  esquema: EsquemaRespuesta;
}

// Metadatos de la llamada. Existen para poder DEMOSTRAR que hubo una
// llamada real al proveedor -- requisito de la convocatoria: el jurado
// debe poder distinguir una decision de IA de una regla escrita a mano.
//
// Deliberadamente NO contienen: la clave, la URL, las cabeceras, el
// prompt, la respuesta del estudiante ni el texto generado. Solo el
// modelo consultado, cuanto tardo, por que termino y el tamano de la
// respuesta -- todo ello no sensible y suficiente como evidencia.
export interface MetadatosLlamada {
  modelo: string;
  duracion_ms: number;
  motivo_finalizacion: string | null;
  caracteres_respuesta: number;
}

export type ResultadoGemini =
  | { estado: 'ok'; texto: string; metadatos: MetadatosLlamada }
  | { estado: 'error'; categoria: 'configuracion' | 'red' | 'proveedor' | 'respuesta_vacia' };

// --- Diagnostico de servidor -------------------------------------------
//
// La respuesta HTTP que ve el navegador NO cambia: sigue siendo un unico
// codigo cerrado ('perfil_no_disponible'). Lo que se agrega aqui es una
// traza EXCLUSIVAMENTE de servidor, porque descartar el cuerpo del error
// del proveedor dejaba el fallo indiagnosticable: cuatro causas muy
// distintas (clave invalida, esquema rechazado, modelo inexistente, cuota
// agotada) colapsaban en el mismo 502 sin ninguna pista.
//
// Nunca se registran: la clave, las cabeceras, la URL, el prompt, las
// respuestas del estudiante ni el perfil generado.

const LONGITUD_MAXIMA_MENSAJE = 200;

// Elimina de un mensaje del proveedor cualquier cosa con forma de
// credencial antes de escribirlo en el log, y lo trunca. Defensa en
// profundidad: Google no deberia reflejar la clave en un mensaje de
// error, pero el log no es el lugar para confiar en eso.
export function sanearMensajeProveedor(mensaje: string): string {
  const limpio = mensaje
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, '[REDACTADO]')
    .replace(/\b(key|apikey|api_key|token|authorization)\b\s*[=:]\s*\S+/gi, '$1=[REDACTADO]')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTADO]')
    .replace(/\s+/g, ' ')
    .trim();

  return limpio.length > LONGITUD_MAXIMA_MENSAJE
    ? `${limpio.slice(0, LONGITUD_MAXIMA_MENSAJE)}…`
    : limpio;
}

// Extrae solo los campos utiles del error estandar de Google
// ({ error: { code, status, message } }). Cualquier otra forma se ignora.
export function resumirErrorProveedor(cuerpo: unknown): { codigo: string; mensaje: string } {
  if (cuerpo === null || typeof cuerpo !== 'object') return { codigo: '?', mensaje: '' };
  const error = (cuerpo as { error?: unknown }).error;
  if (error === null || typeof error !== 'object') return { codigo: '?', mensaje: '' };

  const estado = (error as { status?: unknown }).status;
  const codigo = (error as { code?: unknown }).code;
  const mensaje = (error as { message?: unknown }).message;

  return {
    codigo:
      typeof estado === 'string' ? estado : typeof codigo === 'number' ? String(codigo) : '?',
    mensaje: typeof mensaje === 'string' ? sanearMensajeProveedor(mensaje) : '',
  };
}

function registrarFallo(campos: {
  etapa: string;
  categoria: string;
  http?: number;
  codigo?: string;
  mensaje?: string;
}) {
  const partes = [`etapa=${campos.etapa}`, `categoria=${campos.categoria}`];
  if (campos.http !== undefined) partes.push(`http=${campos.http}`);
  if (campos.codigo) partes.push(`codigo=${campos.codigo}`);
  if (campos.mensaje) partes.push(`mensaje="${campos.mensaje}"`);
  console.error(`[gemini] ${partes.join(' ')}`);
}

// Realiza UNA llamada a generateContent. Devuelve el texto crudo que
// entrego el modelo, sin interpretarlo: el parseo y la validacion son
// responsabilidad de src/lib/gemini/perfil.ts.
//
// Ningun mensaje de error del proveedor se propaga hacia arriba: solo se
// devuelve una categoria. Asi es imposible que un detalle interno (o la
// clave, si Google la reflejara en un mensaje) acabe en la respuesta HTTP
// que ve el navegador.
export async function llamarGemini(peticion: PeticionGemini): Promise<ResultadoGemini> {
  const clave = process.env.GEMINI_API_KEY;
  if (!clave || clave.trim().length === 0) {
    // Se registra unicamente el hecho de que falta, nunca su valor ni su
    // longitud.
    registrarFallo({ etapa: 'configuracion', categoria: 'configuracion' });
    return { estado: 'error', categoria: 'configuracion' };
  }

  const modelo = obtenerModeloGemini();
  const url = `${BASE_API_GEMINI}/${encodeURIComponent(modelo)}:generateContent`;

  const cuerpo = {
    contents: [{ role: 'user', parts: [{ text: peticion.instruccion }] }],
    generationConfig: {
      // Salida estructurada nativa: el modelo devuelve JSON conforme al
      // esquema, de modo que no hace falta extraerlo del texto con
      // expresiones regulares (fragiles y facilmente enganables).
      responseMimeType: 'application/json',
      responseSchema: peticion.esquema,
      temperature: 0.2,
    },
  };

  const comenzoEn = Date.now();

  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // La clave viaja en un encabezado, nunca en la URL: asi no queda
        // registrada en logs de acceso ni en el historial del proxy.
        'x-goog-api-key': clave,
      },
      body: JSON.stringify(cuerpo),
    });
  } catch {
    registrarFallo({ etapa: 'fetch', categoria: 'red' });
    return { estado: 'error', categoria: 'red' };
  }

  if (!respuesta.ok) {
    // El cuerpo del error se lee SOLO para extraer el estado y un mensaje
    // saneado con destino al log del servidor. Nunca se reenvia al
    // navegador: la respuesta HTTP hacia el cliente no cambia.
    const cuerpoError = await respuesta.json().catch(() => null);
    const { codigo, mensaje } = resumirErrorProveedor(cuerpoError);
    registrarFallo({
      etapa: 'respuesta_http',
      categoria: 'proveedor',
      http: respuesta.status,
      codigo,
      mensaje,
    });
    return { estado: 'error', categoria: 'proveedor' };
  }

  let datos: unknown;
  try {
    datos = await respuesta.json();
  } catch {
    registrarFallo({ etapa: 'json', categoria: 'respuesta_vacia', http: respuesta.status });
    return { estado: 'error', categoria: 'respuesta_vacia' };
  }

  const texto = extraerTextoDeRespuesta(datos);
  if (texto === null || texto.trim().length === 0) {
    // Caso tipico: el modelo termino por finishReason (MAX_TOKENS,
    // SAFETY, RECITATION) y no hay "parts". Se registra ese motivo,
    // nunca el contenido.
    registrarFallo({
      etapa: 'extraccion',
      categoria: 'respuesta_vacia',
      http: respuesta.status,
      codigo: motivoDeFinalizacion(datos) ?? '?',
    });
    return { estado: 'error', categoria: 'respuesta_vacia' };
  }

  return {
    estado: 'ok',
    texto,
    metadatos: {
      modelo,
      duracion_ms: Date.now() - comenzoEn,
      motivo_finalizacion: motivoDeFinalizacion(datos),
      caracteres_respuesta: texto.length,
    },
  };
}

// Lee candidates[0].finishReason cuando existe. Es un enumerado cerrado
// del proveedor (STOP, MAX_TOKENS, SAFETY, RECITATION...), no contenido
// generado, por lo que puede registrarse sin filtrar nada del estudiante.
export function motivoDeFinalizacion(datos: unknown): string | null {
  if (datos === null || typeof datos !== 'object') return null;
  const candidatos = (datos as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidatos) || candidatos.length === 0) return null;
  const primero = candidatos[0];
  if (primero === null || typeof primero !== 'object') return null;
  const motivo = (primero as { finishReason?: unknown }).finishReason;
  return typeof motivo === 'string' ? motivo : null;
}

// Navega la forma documentada de la respuesta de generateContent:
//   { candidates: [ { content: { parts: [ { text: "..." } ] } } ] }
// Se recorre con comprobaciones explicitas en cada nivel; si algo no
// encaja se devuelve null y la llamada se trata como respuesta vacia.
// Deliberadamente NO se usa una expresion regular sobre el JSON crudo.
export function extraerTextoDeRespuesta(datos: unknown): string | null {
  if (datos === null || typeof datos !== 'object') return null;
  const candidatos = (datos as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidatos) || candidatos.length === 0) return null;

  const primero = candidatos[0];
  if (primero === null || typeof primero !== 'object') return null;

  const contenido = (primero as { content?: unknown }).content;
  if (contenido === null || typeof contenido !== 'object') return null;

  const partes = (contenido as { parts?: unknown }).parts;
  if (!Array.isArray(partes) || partes.length === 0) return null;

  const textos: string[] = [];
  for (const parte of partes) {
    if (parte !== null && typeof parte === 'object') {
      const texto = (parte as { text?: unknown }).text;
      if (typeof texto === 'string') textos.push(texto);
    }
  }

  return textos.length > 0 ? textos.join('') : null;
}
