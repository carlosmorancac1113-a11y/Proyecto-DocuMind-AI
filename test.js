const apiKey = process.env.GROQ_API_KEY;

async function probarGroq() {
  if (!apiKey) {
    console.error("❌ No se encontró GROQ_API_KEY en el archivo .env");
    return;
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "qwen/qwen3.8-27b",
        messages: [{ role: "user", content: "Responde únicamente: API funcionando correctamente" }]
      })
    });

    const data = await response.json();

    if (data.error) {
      console.error("❌ Error de Groq:", data.error.message);
    } else {
      console.log("✅ Respuesta de Groq:", data.choices[0].message.content);
    }
  } catch (err) {
    console.error("❌ Error de conexión:", err.message);
  }
}

probarGroq();