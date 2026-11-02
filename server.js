// Ejecutar con: node --env-file=.env server.js
// Requiere: npm install express express-fileupload pdf-parse (pdf-parse v2.x)

const express = require('express');
const fileUpload = require('express-fileupload');
const { PDFParse } = require('pdf-parse');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';
const MAX_CHARS = 60000; // límite de seguridad para el contexto del modelo

// Función de persistencia en archivo JSON local
function guardarEnHistorial(nombreArchivo, paginas, resumen) {
  try {
    const rutaHistorial = path.join(__dirname, 'historial.json');
    let historial = [];

    if (fs.existsSync(rutaHistorial)) {
      const data = fs.readFileSync(rutaHistorial, 'utf8');
      historial = JSON.parse(data || '[]');
    }

    historial.unshift({
      id: Date.now(),
      fecha: new Date().toLocaleString('es-GT', { timeZone: 'America/Guatemala' }),
      archivo: nombreArchivo,
      paginas: paginas,
      resumenPrevio: resumen.substring(0, 180) + '...'
    });

    fs.writeFileSync(rutaHistorial, JSON.stringify(historial, null, 2));
  } catch (err) {
    console.error('⚠️ Error al guardar la persistencia en historial.json:', err.message);
  }
}

// Extrae texto plano de un Buffer PDF usando la API de pdf-parse v2
async function extraerTextoPDF(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('El archivo recibido está vacío o no es un Buffer válido.');
  }

  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  try {
    const resultado = await parser.getText();

    if (!resultado || typeof resultado.text !== 'string') {
      throw new Error(
        `La extracción no devolvió un string (tipo recibido: ${typeof resultado?.text}).`
      );
    }

    const texto = resultado.text
      .replace(/^-- \d+ of \d+ --$/gm, '') // marcadores de página
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return { texto, paginas: resultado.total ?? 'N/A' };
  } finally {
    await parser.destroy();
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
      `Error de la API Groq (HTTP ${response.status}):${data?.error?.message || 'respuesta inválida'}`
    );
  }

  const contenido = data?.choices?.[0]?.message?.content;
  if (typeof contenido !== 'string' || contenido.trim().length === 0) {
    throw new Error('La API respondió sin contenido utilizable.');
  }

  return contenido.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

// Middlewares
app.use(express.json());
app.use(
  fileUpload({
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
    abortOnLimit: true,
    useTempFiles: false,
  })
);
app.use(express.static('public'));

// Endpoint para consultar el historial persistido
app.get('/api/historial', (req, res) => {
  const rutaHistorial = path.join(__dirname, 'historial.json');
  if (!fs.existsSync(rutaHistorial)) {
    return res.json({ historial: [] });
  }
  try {
    const data = fs.readFileSync(rutaHistorial, 'utf8');
    res.json({ historial: JSON.parse(data || '[]') });
  } catch (err) {
    res.status(500).json({ error: 'Error leyendo el archivo de persistencia.' });
  }
});

// Endpoint para procesar el PDF
app.post('/api/resumir', async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: 'Falta la GROQ_API_KEY en el servidor.' });
  }

  let pdfFile = req.files?.documento;
  if (Array.isArray(pdfFile)) pdfFile = pdfFile[0];

  if (!pdfFile) {
    return res.status(400).json({ error: 'No se subió ningún archivo PDF.' });
  }

  const esPdf =
    pdfFile.mimetype === 'application/pdf' || pdfFile.name?.toLowerCase().endsWith('.pdf');
  if (!esPdf) {
    return res.status(400).json({ error: 'El archivo debe ser un PDF.' });
  }

  try {
    const { texto, paginas } = await extraerTextoPDF(pdfFile.data);

    if (texto.length === 0) {
      return res.status(400).json({
        error:
          'El PDF no contiene texto extraíble. Probablemente es un documento escaneado (imagen).',
      });
    }

    const textoParaEnviar = texto.length > MAX_CHARS ? texto.slice(0, MAX_CHARS) : texto;
    const informe = await resumirConGroq(textoParaEnviar);

    // Guardar en el historial local (Persistencia)
    guardarEnHistorial(pdfFile.name, paginas, informe);

    res.json({
      exito: true,
      paginas,
      caracteres: texto.length,
      truncado: texto.length > MAX_CHARS,
      informe,
    });
  } catch (err) {
    console.error('❌', err);
    res.status(500).json({ error: 'Error procesando el PDF: ' + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
});