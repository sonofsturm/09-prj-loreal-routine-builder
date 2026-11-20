/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productSearch = document.getElementById("productSearch");
const clearSearchBtn = document.getElementById("clearSearchBtn");
const catalogCount = document.getElementById("catalogCount");
const productsContainer = document.getElementById("productsContainer");
const selectedProductsList = document.getElementById("selectedProductsList");
const clearSelectedBtn = document.getElementById("clearSelectedBtn");
const generateRoutineBtn = document.getElementById("generateRoutine");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");

/* Key used to save selected products in localStorage */
const SELECTED_PRODUCTS_STORAGE_KEY = "lorealSelectedProducts";

/* Automatically apply RTL direction when an RTL language is active */
const RTL_LANGUAGE_PATTERN = /^(ar|he|iw|fa|ur|ps|sd|yi|ckb|syr|dv|ug)\b/i;

function detectRtlDirection() {
  const htmlEl = document.documentElement;
  const htmlLang = (htmlEl.getAttribute("lang") || "").trim();
  const browserLang = (
    (Array.isArray(navigator.languages) && navigator.languages[0]) ||
    navigator.language ||
    ""
  ).trim();

  if (htmlEl.classList.contains("translated-rtl")) {
    return "rtl";
  }
  if (htmlEl.classList.contains("translated-ltr")) {
    return "ltr";
  }
  if (RTL_LANGUAGE_PATTERN.test(htmlLang)) {
    return "rtl";
  }
  if (htmlLang && !/^en\b/i.test(htmlLang)) {
    return "ltr";
  }
  if (RTL_LANGUAGE_PATTERN.test(browserLang)) {
    return "rtl";
  }
  return htmlEl.getAttribute("dir") === "rtl" ? "rtl" : "ltr";
}

function syncLayoutDirection() {
  const nextDir = detectRtlDirection();
  if (document.documentElement.dir !== nextDir) {
    document.documentElement.dir = nextDir;
  }
}

syncLayoutDirection();
window.addEventListener("languagechange", syncLayoutDirection);

const htmlDirectionObserver = new MutationObserver((mutations) => {
  const shouldSync = mutations.some(
    (mutation) =>
      mutation.attributeName === "lang" || mutation.attributeName === "class"
  );
  if (shouldSync) {
    syncLayoutDirection();
  }
});

htmlDirectionObserver.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["lang", "class"],
});

/* System instructions for the L'Oréal routine advisor */
const SYSTEM_PROMPT =
  "You are a knowledgeable L'Oréal beauty and routine advisor with access to real-time web search information. Build clear, step-by-step personalized routines using ONLY the selected products provided as JSON (explaining order of use, AM/PM timing, and why each fits), enriched with current product and routine guidance. Include helpful source links or citations as markdown links like [Source Title](https://...) when referencing current L'Oréal or brand information. For follow-up questions, ONLY answer questions related to the generated routine or beauty and personal care topics such as skincare, haircare, hair color, hair styling, makeup, fragrance, suncare, and men's grooming. If the user asks about anything outside those topics, politely explain that you can only help with their routine and beauty-related topics, and invite them to ask a related question.";

/* Load saved product selections from localStorage safely */
function loadSavedSelectedProducts() {
  try {
    const saved = localStorage.getItem(SELECTED_PRODUCTS_STORAGE_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) => item && typeof item.id === "number" && item.name && item.brand
    );
  } catch (error) {
    console.warn("Could not read saved selections from localStorage:", error);
    return [];
  }
}

/* Save current selectedProducts array to localStorage */
function saveSelectedProducts() {
  try {
    localStorage.setItem(
      SELECTED_PRODUCTS_STORAGE_KEY,
      JSON.stringify(selectedProducts)
    );
  } catch (error) {
    console.warn("Could not save selections to localStorage:", error);
  }
}

/* Store loaded products, selected products, and chat history */
let allProducts = [];
let productsLoadPromise = null;
let selectedProducts = loadSavedSelectedProducts();
let conversationMessages = [{ role: "system", content: SYSTEM_PROMPT }];
let chatDisplayEntries = [];

/* Show initial placeholder until user selects a category or types a search */
function showInitialCatalogPlaceholder() {
  if (catalogCount) {
    catalogCount.textContent = "";
  }
  productsContainer.innerHTML = `
    <div class="placeholder-message">
      Select a category or search by keyword to view products
    </div>
  `;
}

showInitialCatalogPlaceholder();

/* Load product data from JSON file (and cache it for quick lookups) */
async function loadProducts() {
  if (allProducts.length > 0) {
    return allProducts;
  }
  if (!productsLoadPromise) {
    productsLoadPromise = fetch("products.json")
      .then((response) => response.json())
      .then((data) => {
        allProducts = data.products;
        return allProducts;
      });
  }
  return productsLoadPromise;
}

/* Check if a product is currently in the selectedProducts array */
function isProductSelected(productId) {
  return selectedProducts.some((product) => product.id === productId);
}

/* Escape special HTML characters so product names/descriptions render safely */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* Render the "Selected Products" section based on selectedProducts */
function renderSelectedProducts() {
  clearSelectedBtn.hidden = selectedProducts.length === 0;

  if (selectedProducts.length === 0) {
    selectedProductsList.innerHTML = `
      <p class="empty-selected-message">
        No products selected yet. Click a product card above to add it.
      </p>
    `;
    return;
  }

  selectedProductsList.innerHTML = selectedProducts
    .map(
      (product) => `
    <div class="selected-product-item" data-product-id="${product.id}">
      <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" referrerpolicy="no-referrer">
      <div class="selected-product-details">
        <span class="selected-product-name" dir="auto">${escapeHtml(product.name)}</span>
        <span class="selected-product-brand" dir="auto">${escapeHtml(product.brand)}</span>
      </div>
      <button
        type="button"
        class="remove-product-btn"
        data-product-id="${product.id}"
        aria-label="Remove ${escapeHtml(product.name)}"
        title="Remove ${escapeHtml(product.name)}"
      >
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  `
    )
    .join("");
}

/* Sync the visual selected state of visible cards in the product grid */
function updateGridSelectionState() {
  const cards = productsContainer.querySelectorAll(".product-card");
  cards.forEach((card) => {
    const productId = Number(card.dataset.productId);
    const selected = isProductSelected(productId);
    card.classList.toggle("selected", selected);

    const selectTrigger = card.querySelector(".product-card-main");
    if (selectTrigger) {
      selectTrigger.setAttribute("aria-pressed", String(selected));
    }
  });
}

/* Add or remove a product from selectedProducts */
function toggleProductSelection(productId) {
  const alreadySelected = isProductSelected(productId);

  if (alreadySelected) {
    selectedProducts = selectedProducts.filter(
      (product) => product.id !== productId
    );
  } else {
    const productToAdd = allProducts.find(
      (product) => product.id === productId
    );
    if (productToAdd) {
      selectedProducts.push(productToAdd);
    }
  }

  saveSelectedProducts();
  updateGridSelectionState();
  renderSelectedProducts();
}

/* Remove a product directly by ID */
function removeSelectedProduct(productId) {
  selectedProducts = selectedProducts.filter(
    (product) => product.id !== productId
  );
  saveSelectedProducts();
  updateGridSelectionState();
  renderSelectedProducts();
}

/* Clear all selected products at once */
function clearAllSelectedProducts() {
  selectedProducts = [];
  saveSelectedProducts();
  updateGridSelectionState();
  renderSelectedProducts();
}

/* Expand or collapse a product's description cleanly */
function toggleProductDetails(button) {
  const card = button.closest(".product-card");
  if (!card) return;

  const descriptionId = button.getAttribute("aria-controls");
  const descriptionEl = document.getElementById(descriptionId);
  if (!descriptionEl) return;

  const isExpanded = button.getAttribute("aria-expanded") === "true";
  const nextExpanded = !isExpanded;

  button.setAttribute("aria-expanded", String(nextExpanded));
  descriptionEl.hidden = !nextExpanded;

  const labelEl = button.querySelector(".details-btn-label");
  if (labelEl) {
    labelEl.textContent = nextExpanded ? "Hide Details" : "View Details";
  }
}

/* Create HTML for displaying product cards */
function displayProducts(products) {
  if (catalogCount) {
    catalogCount.textContent =
      products.length === 1 ? "1 formula" : `${products.length} formulas`;
  }

  if (products.length === 0) {
    productsContainer.innerHTML = `
      <div class="placeholder-message">
        No products found in this category
      </div>
    `;
    return;
  }

  productsContainer.innerHTML = products
    .map((product) => {
      const selected = isProductSelected(product.id);
      const safeName = escapeHtml(product.name);
      const safeBrand = escapeHtml(product.brand);
      const safeCategory = escapeHtml(product.category);
      const safeDescription = escapeHtml(product.description);
      const safeImage = escapeHtml(product.image);

      return `
    <article
      class="product-card ${selected ? "selected" : ""}"
      data-product-id="${product.id}"
    >
      <span class="selected-badge" aria-hidden="true">
        <i class="fa-solid fa-check"></i> Selected
      </span>
      <div
        class="product-card-main"
        role="button"
        tabindex="0"
        aria-pressed="${selected}"
        aria-label="Select ${safeName} by ${safeBrand}"
      >
        <div class="product-image-frame">
          <img
            src="${safeImage}"
            alt="${safeName}"
            referrerpolicy="no-referrer"
            onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
          >
          <div class="product-image-fallback" aria-hidden="true">
            <i class="fa-solid fa-spray-can-sparkles"></i>
            <span>${safeBrand}</span>
          </div>
        </div>
        <div class="product-info">
          <p class="product-brand">${safeBrand} <span aria-hidden="true">&middot;</span> ${safeCategory}</p>
          <h3>${safeName}</h3>
        </div>
      </div>
      <div class="product-card-actions">
        <button
          type="button"
          class="details-toggle-btn"
          aria-expanded="false"
          aria-controls="product-desc-${product.id}"
        >
          <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
          <span class="details-btn-label">View Details</span>
        </button>
      </div>
      <div id="product-desc-${product.id}" class="product-description" hidden>
        <p dir="auto">${safeDescription}</p>
      </div>
    </article>
  `;
    })
    .join("");
}

/* Handle clicks inside the product grid: toggle details or toggle selection */
productsContainer.addEventListener("click", (e) => {
  const detailsBtn = e.target.closest(".details-toggle-btn");
  if (detailsBtn) {
    toggleProductDetails(detailsBtn);
    return;
  }

  /* Ignore clicks inside an open description so users can select/read text */
  if (e.target.closest(".product-description")) {
    return;
  }

  const card = e.target.closest(".product-card");
  if (!card) return;

  const productId = Number(card.dataset.productId);
  toggleProductSelection(productId);
});

/* Support keyboard selection (Enter or Space) on the card selection trigger */
productsContainer.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const selectTrigger = e.target.closest(".product-card-main");
  if (!selectTrigger) return;

  e.preventDefault();
  const card = selectTrigger.closest(".product-card");
  if (!card) return;

  const productId = Number(card.dataset.productId);
  toggleProductSelection(productId);
});

/* Remove an item when clicking its remove button in the Selected Products list */
selectedProductsList.addEventListener("click", (e) => {
  const removeBtn = e.target.closest(".remove-product-btn");
  if (!removeBtn) return;

  const productId = Number(removeBtn.dataset.productId);
  removeSelectedProduct(productId);
});

/* Clear all saved selections when clicking the Clear All button */
clearSelectedBtn.addEventListener("click", () => {
  clearAllSelectedProducts();
});

/* Filter products by both selected category and search keywords */
async function applyProductFilters() {
  const selectedCategory = categoryFilter.value;
  const rawQuery = productSearch.value.trim().toLowerCase();
  clearSearchBtn.hidden = productSearch.value.length === 0;

  if (!selectedCategory && !rawQuery) {
    showInitialCatalogPlaceholder();
    return;
  }

  const products = await loadProducts();
  const searchTerms = rawQuery.split(/\s+/).filter(Boolean);

  const filteredProducts = products.filter((product) => {
    const matchesCategory =
      !selectedCategory ||
      selectedCategory === "all" ||
      product.category === selectedCategory;

    if (!matchesCategory) {
      return false;
    }

    if (searchTerms.length === 0) {
      return true;
    }

    const searchableText =
      `${product.name} ${product.brand} ${product.category} ${product.description}`.toLowerCase();
    return searchTerms.every((term) => searchableText.includes(term));
  });

  displayProducts(filteredProducts);
}

/* Filter and display products when category changes */
categoryFilter.addEventListener("change", () => {
  if (productSearch.value.length > 0) {
    productSearch.value = "";
  }
  applyProductFilters();
});

/* Filter and display products live as the user types in the search field */
productSearch.addEventListener("input", () => {
  if (productSearch.value.trim().length > 0) {
    categoryFilter.value = "all";
  }
  applyProductFilters();
});

/* Clear the search field and re-apply the active category filter */
clearSearchBtn.addEventListener("click", () => {
  productSearch.value = "";
  productSearch.focus();
  applyProductFilters();
});

/* Render initial empty state in Selected Products */
renderSelectedProducts();

/* Convert markdown links, URLs, headings, and bold text into safe HTML */
function formatMessageHtml(text) {
  let html = escapeHtml(text);

  /* Render markdown headings (## or ###) cleanly */
  html = html.replace(
    /^#{2,4}\s+(.+)$/gm,
    '<strong class="chat-md-heading">$1</strong>'
  );

  /* Render bold (**text**) */
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  /* Render markdown links [label](https://...) safely, preserving placeholders */
  const linkPlaceholders = [];
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_match, label, url) => {
      const cleanUrl = url.replace(/[.,;!?]+$/, "");
      const token = `__LINK_TOKEN_${linkPlaceholders.length}__`;
      linkPlaceholders.push(
        `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="chat-inline-link">${label}</a>`
      );
      return token;
    }
  );

  /* Linkify any remaining bare http(s) URLs */
  html = html.replace(/(https?:\/\/[^\s<]+)/g, (rawUrl) => {
    const cleanUrl = rawUrl.replace(/[).,;!?]+$/, "");
    const trailing = rawUrl.slice(cleanUrl.length);
    return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="chat-inline-link">${cleanUrl}</a>${trailing}`;
  });

  /* Restore markdown link elements */
  linkPlaceholders.forEach((anchorHtml, idx) => {
    html = html.replace(`__LINK_TOKEN_${idx}__`, anchorHtml);
  });

  return html;
}

/* Extract http(s) links from markdown or raw URLs inside a reply */
function extractLinksFromText(text) {
  const found = [];
  const seen = new Set();

  for (const match of String(text).matchAll(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
  )) {
    const url = match[2].replace(/[.,;!?]+$/, "");
    if (!seen.has(url)) {
      seen.add(url);
      found.push({ title: match[1], url });
    }
  }

  for (const match of String(text).matchAll(/https?:\/\/[^\s<>()]+/g)) {
    const url = match[0].replace(/[.,;!?]+$/, "");
    if (!seen.has(url)) {
      seen.add(url);
      found.push({ title: url, url });
    }
  }

  return found;
}

/* Render chat messages, citations, and optional loading state inside #chatWindow */
function renderChatWindow(isLoading = false, loadingText = "Searching & thinking…") {
  if (chatDisplayEntries.length === 0 && !isLoading) {
    chatWindow.innerHTML = `
      <p class="chat-placeholder">
        Select products above and click "Generate Routine" to get started, or ask a question about your routine, skincare, haircare, makeup, or fragrance.
      </p>
    `;
    return;
  }

  const messagesHtml = chatDisplayEntries
    .map((entry) => {
      const label =
        entry.role === "user"
          ? "You"
          : entry.role === "error"
            ? "Notice"
            : "L'Oréal Advisor";

      const citations = Array.isArray(entry.citations) ? entry.citations : [];
      const citationsHtml =
        entry.role === "assistant" && citations.length > 0
          ? `
        <div class="chat-citations">
          <span class="chat-citations-title">Sources &amp; Citations</span>
          <ul class="chat-citations-list">
            ${citations
              .map(
                (cite) => `
              <li>
                <a
                  href="${escapeHtml(cite.url)}"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ${escapeHtml(cite.title || cite.url)}
                  <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
                </a>
              </li>
            `
              )
              .join("")}
          </ul>
        </div>
      `
          : "";

      return `
    <div class="chat-message ${entry.role}">
      <span class="chat-message-label">${label}</span>
      <div class="chat-message-body" dir="auto">${formatMessageHtml(entry.content)}</div>
      ${citationsHtml}
    </div>
  `;
    })
    .join("");

  const loadingHtml = isLoading
    ? `
    <div class="chat-message assistant">
      <span class="chat-message-label">L'Oréal Advisor</span>
      <div class="chat-message-body">${escapeHtml(loadingText)}</div>
    </div>
  `
    : "";

  chatWindow.innerHTML = `${messagesHtml}${loadingHtml}`;
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

/* Collect only the selected products with their key JSON fields */
function getSelectedProductsJson() {
  return selectedProducts.map((product) => ({
    name: product.name,
    brand: product.brand,
    category: product.category,
    description: product.description,
  }));
}

/* Public Cloudflare Worker URL used when hosted statically (e.g., GitHub Pages) */
const CLOUDFLARE_WORKER_URL = "https://damp-fog-2e23.guil-c5e.workers.dev/";

/* Parse JSON safely so HTML 404/405 error pages never throw SyntaxError */
async function parseJsonSafely(response) {
  const contentType = response.headers.get("content-type") || "";
  const rawText = await response.text();
  if (
    !contentType.includes("application/json") &&
    rawText.trim().startsWith("<")
  ) {
    return null;
  }
  try {
    return JSON.parse(rawText);
  } catch {
    return null;
  }
}

/* Send conversationMessages to /api/chat on Node, or directly to the Cloudflare Worker on static hosts */
async function fetchOpenAIReply() {
  let response = null;
  let data = null;

  const isStaticGitHubPages = window.location.hostname.endsWith("github.io");

  if (!isStaticGitHubPages) {
    try {
      response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: conversationMessages,
        }),
      });
      if (response.status !== 404 && response.status !== 405) {
        data = await parseJsonSafely(response);
      }
    } catch {
      /* Fall back to direct Cloudflare Worker request below */
    }
  }

  if (!data) {
    response = await fetch(CLOUDFLARE_WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-search-preview",
        web_search_options: { search_context_size: "medium" },
        messages: conversationMessages,
      }),
    });
    data = await parseJsonSafely(response);
    if (!data) {
      throw new Error(
        "Received an unexpected non-JSON response from the AI service."
      );
    }
  }

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
        data?.error ||
        "Unable to generate a response from the OpenAI API."
    );
  }

  const reply = data?.choices?.[0]?.message?.content;
  if (!reply) {
    throw new Error("The OpenAI API returned an empty response.");
  }

  /* Gather citations from OpenAI annotations, backend citations, and inline links */
  const seenUrls = new Set();
  const citations = [];
  const addCite = (item) => {
    if (
      item &&
      typeof item.url === "string" &&
      /^https?:\/\//i.test(item.url) &&
      !seenUrls.has(item.url)
    ) {
      seenUrls.add(item.url);
      citations.push({
        title: item.title || item.url,
        url: item.url,
      });
    }
  };

  if (Array.isArray(data.citations)) {
    data.citations.forEach(addCite);
  }

  const annotations = data?.choices?.[0]?.message?.annotations;
  if (Array.isArray(annotations)) {
    annotations.forEach((ann) => {
      if (ann?.type === "url_citation" && ann.url_citation) {
        addCite(ann.url_citation);
      }
    });
  }

  extractLinksFromText(reply).forEach(addCite);

  return { reply, citations };
}

/* Toggle loading state on buttons while waiting for the API */
function setChatBusy(isBusy) {
  generateRoutineBtn.disabled = isBusy;
  sendBtn.disabled = isBusy;
  userInput.disabled = isBusy;
}

/* Generate a personalized routine from only the currently selected products */
generateRoutineBtn.addEventListener("click", async () => {
  if (selectedProducts.length === 0) {
    chatDisplayEntries.push({
      role: "error",
      content:
        "Please select at least one product before generating a routine.",
    });
    renderChatWindow(false);
    return;
  }

  /* Collect JSON data for only the selected products */
  const selectedProductsData = getSelectedProductsJson();
  const selectedNames = selectedProductsData
    .map((item) => item.name)
    .join(", ");

  /* Send the full JSON details to OpenAI while showing a clean summary in chat */
  const apiPrompt = `Build a personalized routine using ONLY these currently selected products (provided as JSON). Include current best-practice tips and cite relevant L'Oréal or brand links:\n\n${JSON.stringify(
    selectedProductsData,
    null,
    2
  )}`;

  /* Keep the full conversation history and append this new routine request */
  conversationMessages.push({ role: "user", content: apiPrompt });

  chatDisplayEntries.push({
    role: "user",
    content: `Generate a routine for my selected products: ${selectedNames}`,
  });

  setChatBusy(true);
  renderChatWindow(true, "Searching current L'Oréal info & building your routine…");

  try {
    const { reply, citations } = await fetchOpenAIReply();
    conversationMessages.push({ role: "assistant", content: reply });
    chatDisplayEntries.push({ role: "assistant", content: reply, citations });
  } catch (error) {
    /* Remove the failed request turn so conversation history stays valid */
    conversationMessages.pop();
    chatDisplayEntries.push({
      role: "error",
      content: error.message || "Failed to generate routine.",
    });
  } finally {
    setChatBusy(false);
    renderChatWindow(false);
  }
});

/* Handle follow-up questions in the chat form */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const userMessage = userInput.value.trim();
  if (!userMessage) return;

  userInput.value = "";
  conversationMessages.push({ role: "user", content: userMessage });
  chatDisplayEntries.push({ role: "user", content: userMessage });

  setChatBusy(true);
  renderChatWindow(true, "Searching current L'Oréal info…");

  try {
    const { reply, citations } = await fetchOpenAIReply();
    conversationMessages.push({ role: "assistant", content: reply });
    chatDisplayEntries.push({ role: "assistant", content: reply, citations });
  } catch (error) {
    /* Remove the failed user turn so conversation history stays valid */
    conversationMessages.pop();
    chatDisplayEntries.push({
      role: "error",
      content: error.message || "Failed to send message.",
    });
  } finally {
    setChatBusy(false);
    renderChatWindow(false);
  }
});

/* Render initial chat prompt */
renderChatWindow(false);
