const express = require("express");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";

app.use(express.json());
app.use(express.static(__dirname));

const DEFAULT_CLOUDFLARE_WORKER_URL =
  "https://damp-fog-2e23.guil-c5e.workers.dev/";

const DEFAULT_SEARCH_MODEL =
  process.env.OPENAI_MODEL || "gpt-4o-search-preview";

function decodeXmlEntities(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/<[^>]*>/g, "")
    .trim();
}

/* Perform live web search via Bing RSS for up-to-date L'Oréal & product info */
async function searchWebRss(query) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(
    query
  )}&format=rss`;

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(4500),
  });

  if (!response.ok) {
    throw new Error(`Web search failed with status ${response.status}`);
  }

  const xml = await response.text();
  const items = [];

  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const itemXml = match[1];
    const title = decodeXmlEntities(
      (itemXml.match(/<title>([\s\S]*?)<\/title>/) || [, ""])[1]
    );
    const link = decodeXmlEntities(
      (itemXml.match(/<link>([\s\S]*?)<\/link>/) || [, ""])[1]
    );
    const snippet = decodeXmlEntities(
      (itemXml.match(/<description>([\s\S]*?)<\/description>/) || [, ""])[1]
    );
    const pubDate = decodeXmlEntities(
      (itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [, ""])[1]
    );

    if (title && /^https?:\/\//i.test(link)) {
      items.push({ title, url: link, snippet, pubDate });
    }

    if (items.length >= 4) break;
  }

  return items;
}

/* Normalize conversational text into clean search keywords */
function normalizeSearchText(text) {
  return String(text || "")
    .replace(/l['’]?or[eé]al(\s+paris)?/gi, "LOreal")
    .replace(
      /\b(tell me about|can you|could you|what is|what are|how do i|how to|please|and share a link|share a link|give me|with links|include links|search the web for|about)\b/gi,
      " "
    )
    .replace(/[^\w\s.%'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* Build relevant search queries from the latest user turn */
function buildSearchQueries(messages) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser || typeof lastUser.content !== "string") {
    return ["LOreal Paris skincare routine"];
  }

  const content = lastUser.content.trim();

  /* Check if this is a routine-generation prompt containing selected product JSON */
  const jsonStart = content.indexOf("[");
  if (content.includes("selected products") && jsonStart !== -1) {
    try {
      const products = JSON.parse(content.slice(jsonStart));
      if (Array.isArray(products) && products.length > 0) {
        return products
          .slice(0, 3)
          .map((p) => `${normalizeSearchText(p.brand)} ${normalizeSearchText(p.name)}`.trim());
      }
    } catch {
      /* Fall back to text query below */
    }
  }

  let cleaned = normalizeSearchText(content);
  /* If a specific product line is named alongside LOreal, search the product tokens cleanly */
  const withoutBrandOnly = cleaned.replace(/\bLOreal\b/gi, "").trim();
  if (withoutBrandOnly.split(" ").filter(Boolean).length >= 3) {
    cleaned = withoutBrandOnly;
  }

  const words = cleaned.split(" ").filter(Boolean).slice(0, 9).join(" ");
  if (!words) {
    return ["LOreal Paris skincare routine"];
  }

  const mentionsBeautyTerm =
    /loreal|cerave|la roche|garnier|maybelline|lanc[oô]me|kiehl|redken|k[eé]rastase|vichy|skinceuticals|ysl|revitalift|elvive|skin|hair|serum|cleanser|moisturizer|spf|sunscreen|makeup|fragrance|routine/i.test(
      words
    );

  return [mentionsBeautyTerm ? words : `LOreal ${words}`];
}

/* Fetch grounded live web results across queries */
async function gatherLiveWebContext(messages) {
  const queries = buildSearchQueries(messages);
  const settled = await Promise.allSettled(
    queries.map((q) => searchWebRss(q))
  );

  const seenUrls = new Set();
  const results = [];

  for (const outcome of settled) {
    if (outcome.status === "fulfilled") {
      for (const item of outcome.value) {
        if (!seenUrls.has(item.url)) {
          seenUrls.add(item.url);
          results.push(item);
        }
      }
    }
  }

  return results.slice(0, 6);
}

/* Extract url_citation annotations from OpenAI search-preview responses */
function extractOpenAICitations(data) {
  const annotations = data?.choices?.[0]?.message?.annotations;
  if (!Array.isArray(annotations)) return [];

  const citations = [];
  const seen = new Set();

  for (const ann of annotations) {
    const cite = ann?.url_citation;
    if (
      ann?.type === "url_citation" &&
      cite?.url &&
      /^https?:\/\//i.test(cite.url) &&
      !seen.has(cite.url)
    ) {
      seen.add(cite.url);
      citations.push({
        title: cite.title || cite.url,
        url: cite.url,
      });
    }
  }

  return citations;
}

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res
      .status(400)
      .json({ error: "Request body must include a non-empty messages array." });
  }

  try {
    const workerUrl =
      process.env.CLOUDFLARE_WORKER_URL ||
      (process.env.OPENAI_API_KEY ? "" : DEFAULT_CLOUDFLARE_WORKER_URL);

    if (workerUrl) {
      let liveResults = [];
      try {
        liveResults = await gatherLiveWebContext(messages);
      } catch (searchError) {
        console.warn("Live web search fallback skipped:", searchError.message);
      }

      const today = new Date().toISOString().split("T")[0];
      const augmentedMessages = messages.map((msg) => ({ ...msg }));

      if (liveResults.length > 0) {
        const formattedResults = liveResults
          .map(
            (item, idx) =>
              `[${idx + 1}] ${item.title}\nURL: ${item.url}\nSnippet: ${
                item.snippet || "Official product/brand resource"
              }`
          )
          .join("\n\n");

        /* Attach live web context directly to the latest user turn so the model uses and cites it */
        for (let i = augmentedMessages.length - 1; i >= 0; i--) {
          if (augmentedMessages[i].role === "user") {
            augmentedMessages[i].content = `${augmentedMessages[i].content}\n\n---\nVerified Reference Sources retrieved ${today}:\n${formattedResults}\n\nInstruction: Use the facts from these verified sources above and include 1-3 clickable markdown links like [Source Title](URL) directly in your response using ONLY the exact URLs listed above. Do NOT say you cannot provide links. If the user's request is unrelated to beauty, skincare, haircare, makeup, fragrance, or their routine, politely decline and do NOT include any links.`;
            break;
          }
        }
      }

      const workerResponse = await fetch(workerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: DEFAULT_SEARCH_MODEL,
          web_search_options: { search_context_size: "medium" },
          messages: augmentedMessages,
        }),
      });

      const workerData = await workerResponse.json();
      if (!workerResponse.ok) {
        return res.status(workerResponse.status).json({
          error:
            workerData?.error?.message ||
            workerData?.error ||
            "Cloudflare Worker request failed.",
        });
      }

      const openAICitations = extractOpenAICitations(workerData);
      const replyText = workerData?.choices?.[0]?.message?.content || "";
      const looksLikeRefusal =
        /unable to (provide|help|assist|answer)|can(?:'t|not) (?:provide|help|assist|answer)|can only (?:help|assist)|outside.*topics|unrelated to/i.test(
          replyText
        );

      const fallbackCitations =
        openAICitations.length === 0 && !looksLikeRefusal
          ? liveResults.slice(0, 4).map(({ title, url }) => ({ title, url }))
          : [];

      return res.status(workerResponse.status).json({
        ...workerData,
        citations:
          openAICitations.length > 0 ? openAICitations : fallbackCitations,
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error:
          "OpenAI API key is not configured on the server. Set OPENAI_API_KEY (or CLOUDFLARE_WORKER_URL) in the environment.",
      });
    }

    const requestBody = {
      model: DEFAULT_SEARCH_MODEL,
      messages,
    };

    if (DEFAULT_SEARCH_MODEL.includes("search")) {
      requestBody.web_search_options = { search_context_size: "medium" };
    }

    const openaiResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
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

    return res.json({
      ...openaiData,
      citations: extractOpenAICitations(openaiData),
    });
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
