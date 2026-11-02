// Ejecutar con: node --env-file=.env resumir.js
// Requiere: npm install pdf-parse   (v2.x)

const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';
const PDF_PATH = path.resolve(__dirname, 'documento.pdf');
const MAX_CHARS = 60000; // límite de seguridad para no exceder el contexto/tokens del modelo

async function extraerTextoPDF(rutaPdf) {
  if (!fs.existsSync(rutaPdf)) {
    throw new Error(`No se encontró el archivo: ${rutaPdf}`);
  }

  const buffer = fs.readFileSync(rutaPdf);
  const parser = new PDFParse({ data: buffer });

  try {
    const resultado = await parser.getText();

    // Validación: el texto debe ser un string real
    if (!resultado || typeof resultado.text !== 'string') {
      throw new Error(
        `La extracción no devolvió un string (tipo recibido: ${typeof resultado?.text}).`
      );
    }

    // Limpieza básica: espacios, saltos de línea repetidos y marcadores de página
    const texto = resultado.text
      .replace(/^-- \d+ of \d+ --$/gm, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Validación: no debe estar vacío
    if (texto.length === 0) {
      throw new Error(
        'El PDF no contiene texto extraíble. Probablemente es un documento escaneado (imagen).'
      );
    }

    return { texto, paginas: resultado.total ?? 'N/A' };
  } finally {
    await parser.destroy(); // libera recursos de pdf.js
  }
}

async function resumirConGroq(texto) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content:
            'Eres un asistente ejecutivo. Analiza el documento ingresado y genera un informe ejecutivo estructurado en español con exactamente estas secciones: ' +
            '1. Resumen Ejecutivo (máximo 2 párrafos), ' +
            '2. Puntos Clave (listado), ' +
            '3. Conclusiones y Recomendaciones.',
        },
        {
          role: 'user',
          content: `Analiza el siguiente texto extraído del PDF:\n\n${texto}`,
        },
      ],
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || data?.error) {
    throw new Error(
      `Error de la API Groq (HTTP ${response.status}): ${data?.error?.message || 'respuesta inválida'}`
    );
  }

  const contenido = data?.choices?.[0]?.message?.content;
  if (typeof contenido !== 'string' || contenido.trim().length === 0) {
    throw new Error('La API respondió sin contenido utilizable.');
  }

  // Algunos modelos Qwen incluyen su razonamiento entre <think>...</think>
  return contenido.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

async function main() {
  if (!API_KEY) {
    console.error('❌ Falta GROQ_API_KEY. Ejecuta: node --env-file=.env resumir.js');
    process.exit(1);
  }

  try {
    const { texto, paginas } = await extraerTextoPDF(PDF_PATH);

    console.log(
      `📄 Documento leído (${paginas} páginas, ${texto.length} caracteres). Procesando con la IA...`
    );

    let textoParaEnviar = texto;
    if (texto.length > MAX_CHARS) {
      console.warn(
        `⚠️ El texto supera ${MAX_CHARS} caracteres; se enviará solo el inicio del documento.`
      );
      textoParaEnviar = texto.slice(0, MAX_CHARS);
    }

    const informe = await resumirConGroq(textoParaEnviar);

    console.log('\n=================== INFORME EJECUTIVO GENERADO ===================\n');
    console.log(informe);
    console.log('\n==================================================================\n');
  } catch (err) {
    console.error('❌', err.message);
    process.exit(1);
  }
}

main();