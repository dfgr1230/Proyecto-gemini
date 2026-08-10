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
export const MODELO_GEMINI_POR_DEFECTO = 'gemini-2.5-flash';

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

export type ResultadoGemini =
  | { estado: 'ok'; texto: string }
  | { estado: 'error'; categoria: 'configuracion' | 'red' | 'proveedor' | 'respuesta_vacia' };

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
    return { estado: 'error', categoria: 'red' };
  }

  if (!respuesta.ok) {
    // El cuerpo del error del proveedor se descarta a proposito: no se
    // lee, no se registra y no se reenvia.
    return { estado: 'error', categoria: 'proveedor' };
  }

  let datos: unknown;
  try {
    datos = await respuesta.json();
  } catch {
    return { estado: 'error', categoria: 'respuesta_vacia' };
  }

  const texto = extraerTextoDeRespuesta(datos);
  if (texto === null || texto.trim().length === 0) {
    return { estado: 'error', categoria: 'respuesta_vacia' };
  }

  return { estado: 'ok', texto };
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
