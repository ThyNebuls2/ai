import {
    CreateMLCEngine,
    ModelType,
    prebuiltAppConfig
} from "https://esm.run/@mlc-ai/web-llm@0.2.82";

// -----------------------------------------------------------------------------
// DOM
// -----------------------------------------------------------------------------
const views = {
    chat: document.getElementById("chat-view"),
    profile: document.getElementById("profile-view"),
    system: document.getElementById("system-prompt-view"),
    explore: document.getElementById("explore-view")
};

const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const newChatBtn = document.getElementById("new-chat-btn");
const historyList = document.getElementById("history-list");
const statusMsg = document.getElementById("status-msg");
const cancelLoadBtn = document.getElementById("cancel-load-btn");
const loadingContainer = document.getElementById("loading-container");
const modelSelect = document.getElementById("model-select");
const attachBtn = document.getElementById("attach-btn");
const fileUpload = document.getElementById("file-upload");
const attachmentPreview = document.getElementById("attachment-preview");
const attachmentList = document.getElementById("attachment-list");
const removeAttachmentBtn = document.getElementById("remove-attachment-btn");
const profileTextarea = document.getElementById("profile-textarea");
const systemPromptTextarea = document.getElementById("system-prompt-textarea");
const modelSearch = document.getElementById("model-search");

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------
let engine = null;
let isBusy = false;
let cancelLoadingFlag = false;
let currentChatId = Date.now().toString();
let chats = JSON.parse(localStorage.getItem("local_ai_chats") || "{}");
let currentMessages = chats[currentChatId] || [];
let currentAttachedFiles = [];

let savedProfile = localStorage.getItem("local_ai_profile_text") || "";
let savedSysPrompt = localStorage.getItem("local_ai_sys_prompt_text") ||
    "You are a helpful, private AI assistant.";

profileTextarea.value = savedProfile;
systemPromptTextarea.value = savedSysPrompt;

// -----------------------------------------------------------------------------
// Model catalogue
// We use WebLLM's own prebuilt registry. That means every selectable model is a
// model that the exact WebLLM build in this app knows how to load.
// -----------------------------------------------------------------------------
const PREBUILT_RECORDS = prebuiltAppConfig.model_list;
const PREBUILT_BY_ID = new Map(PREBUILT_RECORDS.map(record => [record.model_id, record]));

const BASE_MODEL_IDS = [
    "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    "gemma-2-2b-it-q4f16_1-MLC",
    "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    "Phi-3.5-mini-instruct-q4f16_1-MLC",
    "Llama-3.1-8B-Instruct-q4f16_1-MLC"
];

// 20 additional current prebuilt models, selected for web practicality.
// The two Phi-3.5 Vision variants are included separately below because they
// are the vision-language models currently exposed by this WebLLM generation.
const EXTRA_MODEL_IDS_PREFERRED = [
    "Llama-3.2-1B-Instruct-q4f32_1-MLC",
    "Llama-3.2-3B-Instruct-q4f32_1-MLC",
    "Llama-3.1-8B-Instruct-q4f16_1-MLC-1k",
    "Hermes-2-Theta-Llama-3-8B-q4f16_1-MLC",
    "Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC",
    "Hermes-3-Llama-3.2-3B-q4f16_1-MLC",
    "Hermes-3-Llama-3.1-8B-q4f16_1-MLC",
    "Hermes-2-Pro-Mistral-7B-q4f16_1-MLC",
    "Phi-3.5-mini-instruct-q4f32_1-MLC-1k",
    "Phi-4-mini-instruct-q4f16_1-MLC",
    "Mistral-7B-Instruct-v0.3-q4f16_1-MLC",
    "SmolLM2-1.7B-Instruct-q4f16_1-MLC",
    "SmolLM2-360M-Instruct-q4f16_1-MLC",
    "SmolLM2-135M-Instruct-q0f16-MLC",
    "gemma-2-2b-it-q4f16_1-MLC-1k",
    "Qwen2.5-0.5B-Instruct-q4f32_1-MLC",
    "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    "Qwen2.5-3B-Instruct-q4f32_1-MLC",
    "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC",
    "Qwen2.5-Math-1.5B-Instruct-q4f16_1-MLC"
];

const VISION_MODEL_IDS = PREBUILT_RECORDS
    .filter(record => record.model_type === ModelType.VLM)
    .map(record => record.model_id);

// Always expose exactly 20 additional models when the WebLLM build contains
// at least 20 candidates. The curated list is preferred; the remaining slots
// are filled from the real prebuilt registry, never from guessed model IDs.
const EXTRA_MODEL_IDS = [...new Set([
    ...EXTRA_MODEL_IDS_PREFERRED.filter(id => PREBUILT_BY_ID.has(id)),
    ...PREBUILT_RECORDS
        .filter(record => !BASE_MODEL_IDS.includes(record.model_id))
        .filter(record => !VISION_MODEL_IDS.includes(record.model_id))
        .sort((a, b) => (a.vram_required_MB || Infinity) - (b.vram_required_MB || Infinity))
        .map(record => record.model_id)
])].slice(0, 20);

const CATALOG_IDS = [...new Set([
    ...BASE_MODEL_IDS,
    ...EXTRA_MODEL_IDS,
    ...VISION_MODEL_IDS
])].filter(id => PREBUILT_BY_ID.has(id));

function isVisionRecord(record) {
    return record?.model_type === ModelType.VLM;
}

function makeModelDescription(record) {
    const id = record.model_id.toLowerCase();
    if (isVisionRecord(record)) return "Vision-language model for image understanding and visual question answering.";
    if (id.includes("coder")) return "Code-focused model for programming and technical tasks.";
    if (id.includes("math")) return "Math-focused instruction model.";
    if (id.includes("deepseek")) return "Reasoning-focused model; needs more memory than the small models.";
    if (id.includes("smollm2-135m")) return "Extremely small model for very low-memory devices.";
    if (id.includes("smollm2-360m")) return "Tiny model with a very small memory footprint.";
    if (id.includes("smollm2")) return "Small, fast general-purpose model.";
    if (id.includes("hermes")) return "Instruction-following model tuned for assistant-style conversations.";
    if (id.includes("mistral")) return "Strong general-purpose instruction model; requires more memory.";
    if (id.includes("gemma")) return "Google Gemma instruction model.";
    if (id.includes("phi-4")) return "Compact modern reasoning and instruction model.";
    if (id.includes("phi-3.5-mini")) return "Compact Microsoft instruction model.";
    if (id.includes("qwen2.5-0.5b")) return "Very small Qwen model; excellent for low-memory devices.";
    if (id.includes("qwen2.5-1.5b")) return "Small Qwen model with a good speed/intelligence balance.";
    if (id.includes("qwen2.5-3b")) return "Balanced Qwen model for general tasks.";
    if (id.includes("qwen2.5-7b")) return "Larger Qwen model with stronger reasoning and higher memory use.";
    if (id.includes("llama-3.2-1b")) return "Fast compact Llama model.";
    if (id.includes("llama-3.2-3b")) return "Balanced Llama model with stronger reasoning.";
    if (id.includes("llama-3.1-8b")) return "Strong Llama model; requires substantially more memory.";
    return "Local WebLLM model.";
}

const ALL_MODELS = CATALOG_IDS.map(id => {
    const record = PREBUILT_BY_ID.get(id);
    return {
        id,
        name: record.model_id
            .replace(/-q4f16_1-MLC(-1k)?$/i, "")
            .replace(/-q4f32_1-MLC(-1k)?$/i, "")
            .replace(/-q0f16-MLC(-1k)?$/i, "")
            .replace(/-q0f32-MLC(-1k)?$/i, ""),
        desc: makeModelDescription(record),
        images: isVisionRecord(record),
        lowResource: Boolean(record.low_resource_required),
        vramMB: record.vram_required_MB || null
    };
});

function getModel(modelId) {
    return ALL_MODELS.find(model => model.id === modelId);
}

function isVisionModel(modelId) {
    return Boolean(getModel(modelId)?.images);
}

let recentModels = JSON.parse(localStorage.getItem("local_ai_recent_models") || "[]")
    .filter(id => getModel(id));

let currentModel = localStorage.getItem("local_ai_model");
if (!getModel(currentModel)) {
    currentModel = recentModels[0] ||
        BASE_MODEL_IDS.find(id => getModel(id)) ||
        ALL_MODELS[0]?.id;
}

// -----------------------------------------------------------------------------
// Navigation / settings
// -----------------------------------------------------------------------------
function switchView(name) {
    Object.values(views).forEach(view => view.classList.remove("active-view"));
    views[name].classList.add("active-view");
}

document.getElementById("profile-btn").onclick = () => switchView("profile");
document.getElementById("system-prompt-btn").onclick = () => switchView("system");

profileTextarea.addEventListener("input", event => {
    savedProfile = event.target.value;
    localStorage.setItem("local_ai_profile_text", savedProfile);
});

systemPromptTextarea.addEventListener("input", event => {
    savedSysPrompt = event.target.value;
    localStorage.setItem("local_ai_sys_prompt_text", savedSysPrompt);
});

function updateModelSelectDropdown() {
    modelSelect.innerHTML = "";

    recentModels.slice(0, 3).forEach(id => {
        const model = getModel(id);
        if (!model) return;
        const option = document.createElement("option");
        option.value = id;
        option.textContent = model.name + (model.images ? " • 📷" : "");
        modelSelect.appendChild(option);
    });

    const explore = document.createElement("option");
    explore.value = "explore_all";
    explore.textContent = "Explore all models...";
    modelSelect.appendChild(explore);

    modelSelect.value = currentModel;
}

function setControlsEnabled(enabled) {
    const disabled = !enabled || isBusy;
    userInput.disabled = disabled;
    sendBtn.disabled = disabled;
    attachBtn.disabled = disabled;
}

// -----------------------------------------------------------------------------
// WebLLM loading
// -----------------------------------------------------------------------------
async function initAI(modelId) {
    if (!getModel(modelId)) return;

    cancelLoadingFlag = false;
    currentModel = modelId;
    localStorage.setItem("local_ai_model", currentModel);
    recentModels = [modelId, ...recentModels.filter(id => id !== modelId)].slice(0, 8);
    localStorage.setItem("local_ai_recent_models", JSON.stringify(recentModels));
    updateModelSelectDropdown();

    const model = getModel(modelId);
    statusMsg.textContent = `Preparing ${model.name}...`;
    statusMsg.style.color = "var(--yellow)";
    cancelLoadBtn.style.display = "block";
    chatMessages.appendChild(loadingContainer);
    setControlsEnabled(false);

    try {
        if (engine) {
            await engine.unload();
            engine = null;
        }

        // Keep the app configuration tied to the exact WebLLM package version.
        engine = await CreateMLCEngine(modelId, {
            appConfig: {
                ...prebuiltAppConfig,
                model_list: prebuiltAppConfig.model_list
            },
            initProgressCallback: progress => {
                if (cancelLoadingFlag) throw new Error("LoadCancelledByUser");
                const percent = Math.round((progress.progress || 0) * 100);
                statusMsg.textContent = `Downloading/Loading: ${percent}%`;
                statusMsg.style.color = "var(--yellow)";
            }
        });

        statusMsg.textContent = `${model.name} loaded. Ready when you are!`;
        statusMsg.style.color = "var(--yellow)";
        cancelLoadBtn.style.display = "none";
        setControlsEnabled(true);
        renderHistorySidebar();
        loadChat(currentChatId);
    } catch (error) {
        statusMsg.textContent = error.message === "LoadCancelledByUser"
            ? "Loading cancelled. Select a model to start."
            : `Error: ${error.message}`;
        statusMsg.style.color = error.message === "LoadCancelledByUser" ? "#aaa" : "#ff8a8a";
        cancelLoadBtn.style.display = "none";
        engine = null;
        setControlsEnabled(false);
        console.error(error);
    }
}

cancelLoadBtn.onclick = async () => {
    cancelLoadingFlag = true;
    try {
        if (engine) await engine.unload();
    } catch (_) {}
    engine = null;
    setControlsEnabled(false);
};

modelSelect.addEventListener("change", event => {
    if (event.target.value === "explore_all") {
        switchView("explore");
        renderModelExplorer();
        event.target.value = currentModel;
        return;
    }
    switchView("chat");
    initAI(event.target.value);
});

// -----------------------------------------------------------------------------
// Model explorer
// -----------------------------------------------------------------------------
function createModelCard(model) {
    const card = document.createElement("div");
    card.className = "model-card";
    card.innerHTML = `
        <h4>${escapeHtml(model.name)}</h4>
        <p>${escapeHtml(model.desc)}</p>
        ${model.images ? '<span class="model-capability">📷 supports images.</span>' : ""}
        ${model.lowResource ? '<span class="model-resource">✓ low-resource friendly</span>' : ""}
    `;
    card.onclick = () => {
        switchView("chat");
        initAI(model.id);
    };
    return card;
}

function renderModelExplorer(filterText = "") {
    const recentGrid = document.getElementById("recent-models-grid");
    const allGrid = document.getElementById("all-models-grid");
    const recentSection = document.getElementById("recent-models-section");
    const search = filterText.trim().toLowerCase();

    recentGrid.innerHTML = "";
    allGrid.innerHTML = "";

    const filtered = ALL_MODELS.filter(model => {
        if (!search) return true;
        return model.name.toLowerCase().includes(search) ||
            model.desc.toLowerCase().includes(search) ||
            (model.images && "image vision camera".includes(search));
    });

    const recent = recentModels
        .map(id => getModel(id))
        .filter(Boolean)
        .filter(model => !search || filtered.includes(model));

    recentSection.style.display = recent.length && !search ? "block" : "none";
    recent.forEach(model => recentGrid.appendChild(createModelCard(model)));
    filtered.forEach(model => allGrid.appendChild(createModelCard(model)));
}

modelSearch.addEventListener("input", event => renderModelExplorer(event.target.value));

// -----------------------------------------------------------------------------
// Attachments
// -----------------------------------------------------------------------------
attachBtn.onclick = () => fileUpload.click();

fileUpload.addEventListener("change", async event => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    try {
        await addFiles(files);
    } catch (error) {
        alert(error.message);
    } finally {
        fileUpload.value = "";
    }
});

async function addFiles(files) {
    const prepared = [];
    for (const file of files) {
        if (file.type.startsWith("image/")) {
            prepared.push(await prepareImageFile(file));
        } else {
            prepared.push(await prepareTextFile(file));
        }
    }

    currentAttachedFiles.push(...prepared);
    renderAttachmentPreview();
}

// The WebLLM VLM path can fail when one image's embedding is larger than the
// compiled 2048-token prefill chunk. Reducing the image dimensions before it is
// handed to WebLLM is the reliable browser-side fix because no model recompilation
// is needed. 448 px is deliberately conservative while retaining screenshot text.
function prepareImageFile(file) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(file);

        image.onload = () => {
            try {
                let width = image.naturalWidth || image.width;
                let height = image.naturalHeight || image.height;
                const MAX_DIMENSION = 448;
                const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
                width = Math.max(1, Math.round(width * scale));
                height = Math.max(1, Math.round(height * scale));

                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d", { alpha: false });
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(image, 0, 0, width, height);

                // JPEG keeps pasted PNG screenshots small enough for browser memory.
                // If the first encode is still unusually large, make one more pass.
                let dataUrl = canvas.toDataURL("image/jpeg", 0.78);
                if (dataUrl.length > 220_000) {
                    const smaller = document.createElement("canvas");
                    const secondaryScale = 320 / Math.max(width, height);
                    smaller.width = Math.max(1, Math.round(width * Math.min(1, secondaryScale)));
                    smaller.height = Math.max(1, Math.round(height * Math.min(1, secondaryScale)));
                    const smallCtx = smaller.getContext("2d", { alpha: false });
                    smallCtx.fillStyle = "#ffffff";
                    smallCtx.fillRect(0, 0, smaller.width, smaller.height);
                    smallCtx.drawImage(image, 0, 0, smaller.width, smaller.height);
                    dataUrl = smaller.toDataURL("image/jpeg", 0.70);
                }

                resolve({
                    name: file.name || "pasted-image.jpg",
                    isImage: true,
                    data: dataUrl
                });
            } catch (error) {
                reject(new Error(`Could not process image: ${file.name || "pasted image"}`));
            } finally {
                URL.revokeObjectURL(url);
            }
        };

        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error(`Could not read image: ${file.name || "pasted image"}`));
        };

        image.src = url;
    });
}

function prepareTextFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = event => resolve({
            name: file.name,
            isImage: false,
            data: String(event.target.result || "")
        });
        reader.onerror = () => reject(new Error(`Could not read file: ${file.name}`));
        reader.readAsText(file);
    });
}

// Paste screenshots/images directly into the message field.
userInput.addEventListener("paste", async event => {
    const imageFiles = Array.from(event.clipboardData?.items || [])
        .filter(item => item.type.startsWith("image/"))
        .map(item => item.getAsFile())
        .filter(Boolean);

    if (!imageFiles.length) return;

    event.preventDefault();
    try {
        await addFiles(imageFiles);
    } catch (error) {
        alert(error.message);
    }
});

function renderAttachmentPreview() {
    attachmentList.innerHTML = "";
    if (!currentAttachedFiles.length) {
        attachmentPreview.style.display = "none";
        return;
    }

    currentAttachedFiles.forEach(file => {
        const pill = document.createElement("div");
        pill.className = "pending-attachment";

        if (file.isImage) {
            const image = document.createElement("img");
            image.src = file.data;
            image.alt = file.name;
            pill.appendChild(image);
        }

        const name = document.createElement("span");
        name.textContent = `${file.isImage ? "📷 " : "📎 "}${file.name}`;
        pill.appendChild(name);
        attachmentList.appendChild(pill);
    });

    attachmentPreview.style.display = "flex";
}

function clearAttachments() {
    currentAttachedFiles = [];
    attachmentList.innerHTML = "";
    attachmentPreview.style.display = "none";
    fileUpload.value = "";
}

removeAttachmentBtn.onclick = clearAttachments;

// -----------------------------------------------------------------------------
// Chat / history
// -----------------------------------------------------------------------------
function appendMessageToUI(role, text, msgId = null, metricsHtml = "", attachments = []) {
    const container = document.createElement("div");
    container.className = `message-container ${role === "user" ? "user" : "ai"}`;

    const message = document.createElement("div");
    message.className = `message ${role === "user" ? "user-msg" : "ai-msg"}`;

    for (const attachment of attachments || []) {
        if (attachment.isImage && attachment.data) {
            const image = document.createElement("img");
            image.src = attachment.data;
            image.alt = attachment.name || "image";
            image.className = "chat-image-preview";
            message.appendChild(image);
        } else if (!attachment.isImage) {
            const pill = document.createElement("div");
            pill.className = "attachment-pill";
            pill.textContent = `📎 ${attachment.name}`;
            message.appendChild(pill);
            message.appendChild(document.createElement("br"));
        }
    }

    message.appendChild(document.createTextNode(text || ""));
    if (msgId) message.id = msgId;
    container.appendChild(message);

    if (metricsHtml) {
        const metrics = document.createElement("div");
        metrics.className = "metrics";
        metrics.innerHTML = metricsHtml;
        container.appendChild(metrics);
    }

    chatMessages.appendChild(container);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function saveChatToLocal() {
    if (!currentMessages.length) return;
    try {
        chats[currentChatId] = currentMessages;
        localStorage.setItem("local_ai_chats", JSON.stringify(chats));
    } catch (error) {
        console.error("Storage error (browser storage may be full):", error);
    }
    renderHistorySidebar();
}

function renderHistorySidebar() {
    historyList.innerHTML = "";

    Object.keys(chats).reverse().forEach(id => {
        const item = document.createElement("div");
        item.className = `history-item ${id === currentChatId ? "active" : ""}`;
        item.onclick = () => {
            switchView("chat");
            loadChat(id);
        };

        const title = document.createElement("span");
        title.className = "chat-title";
        title.textContent = chats[id][0]?.displayContent || "New Chat";

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "delete-btn";
        deleteBtn.innerHTML = "&times;";
        deleteBtn.onclick = event => {
            event.stopPropagation();
            delete chats[id];
            localStorage.setItem("local_ai_chats", JSON.stringify(chats));
            if (currentChatId === id) newChatBtn.click();
            else renderHistorySidebar();
        };

        item.appendChild(title);
        item.appendChild(deleteBtn);
        historyList.appendChild(item);
    });
}

function loadChat(id) {
    currentChatId = id;
    currentMessages = chats[id] || [];
    chatMessages.innerHTML = "";
    chatMessages.appendChild(loadingContainer);

    for (const message of currentMessages) {
        appendMessageToUI(
            message.role,
            message.displayContent || message.content || "",
            null,
            "",
            message.role === "user" ? (message.attachments || []) : []
        );
    }

    renderHistorySidebar();
}

newChatBtn.onclick = () => {
    switchView("chat");
    currentChatId = Date.now().toString();
    currentMessages = [];
    loadChat(currentChatId);
};

// -----------------------------------------------------------------------------
// Send
// -----------------------------------------------------------------------------
sendBtn.onclick = async () => {
    const rawInput = userInput.value.trim();
    if ((!rawInput && !currentAttachedFiles.length) || !engine || isBusy) return;

    const attachments = currentAttachedFiles.map(file => ({
        name: file.name,
        isImage: file.isImage,
        data: file.data
    }));

    const hasImages = attachments.some(file => file.isImage);
    if (hasImages && !isVisionModel(currentModel)) {
        alert(`"${getModel(currentModel)?.name || currentModel}" does not support images. Select a model marked "📷 supports images." in Explore all models.`);
        return;
    }

    isBusy = true;
    setControlsEnabled(false);

    const displayText = rawInput || (
        hasImages
            ? `Please analyze ${attachments.filter(file => file.isImage).length > 1 ? "these images" : "this image"} in detail.`
            : "Please analyze these files."
    );

    const storedAttachments = attachments.map(file => ({
        name: file.name,
        isImage: file.isImage,
        data: file.data
    }));

    const messageObj = {
        role: "user",
        content: null,
        promptText: rawInput,
        displayContent: displayText,
        attachments: storedAttachments
    };

    userInput.value = "";
    clearAttachments();
    currentMessages.push(messageObj);
    appendMessageToUI("user", displayText, null, "", storedAttachments);
    saveChatToLocal();

    const replyId = `reply-${Date.now()}`;
    const metricId = `metric-${replyId}`;
    appendMessageToUI(
        "assistant",
        "...",
        replyId,
        `<span id="${metricId}">${hasImages ? "Analysing Image: 0%" : "Generating..."}</span>`
    );

    const replyDiv = document.getElementById(replyId);
    const metricSpan = document.getElementById(metricId);
    const startTime = performance.now();

    try {
        const memCtx = savedProfile.trim() ? `User info: ${savedProfile}. ` : "";
        const sysInstruction = `${savedSysPrompt}\n\n${memCtx}\nRULE: If the user tells you a new fact about themselves, silently append it at the very end of your response inside <memory> tags, exactly like <memory>fact</memory>.`;

        const parts = [];
        if (rawInput) {
            parts.push({ type: "text", text: rawInput });
        } else if (hasImages) {
            parts.push({
                type: "text",
                text: attachments.filter(file => file.isImage).length > 1
                    ? "Analyze each attached image carefully. Discuss them separately and in order."
                    : "Describe and analyze this image in detail."
            });
        } else {
            parts.push({ type: "text", text: "Please analyze the attached files." });
        }

        for (const attachment of attachments) {
            if (attachment.isImage) {
                parts.push({
                    type: "image_url",
                    image_url: { url: attachment.data }
                });
            } else {
                parts.push({
                    type: "text",
                    text: `\n\n--- Attached File: ${attachment.name} ---\n${attachment.data}\n--- End of File ---`
                });
            }
        }

        const currentPayload = hasImages ? parts : parts.map(part => part.text).join("");
        const messagesForModel = currentMessages.slice(-10).map(message => {
            if (message === messageObj) return { role: "user", content: currentPayload };
            return { role: message.role, content: messageToModelContent(message) };
        });

        if (hasImages) {
            metricSpan.textContent = "Analysing Image: 15%";
            await nextFrame();
        }

        const stream = await engine.chat.completions.create({
            messages: [
                { role: "system", content: sysInstruction },
                ...messagesForModel
            ],
            stream: true
        });

        let replyText = "";
        let chunkCount = 0;

        for await (const chunk of stream) {
            replyText += chunk.choices[0]?.delta?.content || "";
            chunkCount++;

            if (hasImages) {
                const progress = Math.min(
                    97,
                    Math.round(20 + 77 * (1 - Math.exp(-chunkCount / 16)))
                );
                metricSpan.textContent = `Analysing Image: ${progress}%`;
            }

            replyDiv.textContent = stripMemoryTagFromStream(replyText);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        const timeSec = Math.max((performance.now() - startTime) / 1000, 0.001);
        const estTokens = Math.max(1, Math.round(replyText.length / 4));
        if (hasImages) {
            metricSpan.textContent = "Analysing Image: 100%";
        }

        const cleanReply = replyText.replace(/<memory>[\s\S]*?<\/memory>/gi, "").trim();
        replyDiv.textContent = cleanReply || "(No text response returned.)";

        if (hasImages) {
            metricSpan.textContent = `Analysed • ${estTokens} tokens • ${timeSec.toFixed(1)}s`;
        } else {
            metricSpan.textContent = `${estTokens} tokens • ${timeSec.toFixed(1)}s • ${(estTokens / timeSec).toFixed(1)} tok/s`;
        }

        updateMemoryFromReply(replyText);

        currentMessages.push({
            role: "assistant",
            content: cleanReply,
            displayContent: cleanReply
        });
        saveChatToLocal();
    } catch (error) {
        console.error(error);
        replyDiv.textContent = `Generation failed: ${error?.message || "unknown error"}`;
        metricSpan.textContent = hasImages ? "Image analysis failed" : "Generation failed";
    } finally {
        isBusy = false;
        setControlsEnabled(Boolean(engine));
        userInput.focus();
    }
};

userInput.addEventListener("keypress", event => {
    if (event.key === "Enter") sendBtn.click();
});

function messageToModelContent(message) {
    if (message.role !== "user" || !message.attachments?.length) {
        return message.content || message.displayContent || "";
    }

    const parts = [];
    const prompt = message.promptText || "";
    if (prompt) parts.push({ type: "text", text: prompt });

    for (const attachment of message.attachments) {
        if (attachment.isImage && attachment.data) {
            parts.push({
                type: "image_url",
                image_url: { url: attachment.data }
            });
        } else if (!attachment.isImage && attachment.data) {
            parts.push({
                type: "text",
                text: `\n\n--- Attached File: ${attachment.name} ---\n${attachment.data}\n--- End of File ---`
            });
        }
    }

    return parts.some(part => part.type === "image_url")
        ? parts
        : parts.map(part => part.text || "").join("");
}

function stripMemoryTagFromStream(text) {
    return text.includes("<memory>") ? text.split("<memory>")[0] : text;
}

function updateMemoryFromReply(replyText) {
    const matches = [...replyText.matchAll(/<memory>\s*(.*?)\s*<\/memory>/gi)];
    for (const match of matches) {
        const fact = match[1].trim();
        if (!fact || savedProfile.includes(fact)) continue;
        savedProfile += `${savedProfile ? "\n" : ""}- ${fact}`;
        profileTextarea.value = savedProfile;
        localStorage.setItem("local_ai_profile_text", savedProfile);
    }
}

function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(resolve));
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

// -----------------------------------------------------------------------------
// Boot
// -----------------------------------------------------------------------------
updateModelSelectDropdown();
renderModelExplorer();
renderHistorySidebar();
initAI(currentModel);
