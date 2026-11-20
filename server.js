const express = require("express");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";

app.use(express.json());
app.use(express.static(__dirname));

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res
      .status(400)
      .json({ error: "Request body must include a non-empty messages array." });
  }

  try {
    const workerUrl = process.env.CLOUDFLARE_WORKER_URL;
    if (workerUrl) {
      const workerResponse = await fetch(workerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      const workerData = await workerResponse.json();
      return res.status(workerResponse.status).json(workerData);
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error:
          "OpenAI API key is not configured on the server. Set OPENAI_API_KEY (or CLOUDFLARE_WORKER_URL) in the environment.",
      });
    }

    const openaiResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4.1",
          messages,
        }),
      }
    );

    const openaiData = await openaiResponse.json();
    if (!openaiResponse.ok) {
      return res.status(openaiResponse.status).json({
        error:
          openaiData?.error?.message ||
          "OpenAI API request failed. Please check your configuration.",
      });
    }

    return res.json(openaiData);
  } catch (error) {
    console.error("Error calling AI service:", error);
    return res
      .status(500)
      .json({ error: "Failed to reach the AI service. Please try again." });
  }
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
