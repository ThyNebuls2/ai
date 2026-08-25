import { CreateMLCEngine, prebuiltAppConfig, ModelType } from "https://esm.run/@mlc-ai/web-llm";

// --- DOM Elements ---
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

// --- Global State ---
let engine = null;
let currentChatId = Date.now().toString();
let chats = JSON.parse(localStorage.getItem("local_ai_chats")) || {};
let currentMessages = chats[currentChatId] || [];
let cancelLoadingFlag = false;

let currentAttachedFiles = [];
let isBusy = false;

// --- Settings ---
let savedProfile = localStorage.getItem("local_ai_profile_text") || "";
let savedSysPrompt = localStorage.getItem("local_ai_sys_prompt_text") ||
    "You are a helpful, private AI assistant.";

document.getElementById("profile-textarea").value = savedProfile;
document.getElementById("system-prompt-textarea").value = savedSysPrompt;

// --- Model Catalog ----------------------------------------------------------
// Use WebLLM's own registry as the source of truth. This means the explorer
// shows every prebuilt conversational model exposed by the WebLLM version
// currently loaded by the page, including VLMs such as Ministral when present.
const REGISTRY = Array.isArray(prebuiltAppConfig?.model_list)
    ? prebuiltAppConfig.model_list
    : [];

const enumVLM = ModelType?.VLM;

function isVisionRecord(record) {
    if (!record) return false;
    if (record.model_type === enumVLM) return true;

    // Fallback for registries which omit model_type on a known VLM family.
    const id = String(record.model_id || "").toLowerCase();
    return /vision|vlm|ministral-3-/.test(id);
}

function estimateMissingVRAM(record) {
    if (Number.isFinite(record?.vram_required_MB)) {
        return {
            value: Number(record.vram_required_MB),
            estimated: false,
            source: "WebLLM"
        };
    }

    const id = String(record?.model_id || "").toLowerCase();

    // Mistral documents the Ministral 3 3B BF16 family as fitting in ~16 GB
    // of VRAM. WebLLM does not currently populate vram_required_MB for these
    // records, so show this as an estimate rather than an exact registry value.
    if (
        /ministral-3-3b-(base-2512|reasoning-2512|instruct-2512-bf16)/i.test(
            record?.model_id || ""
        )
    ) {
        return {
            value: 16384,
            estimated: true,
            source: "Mistral published requirement"
        };
    }

    // Generic last-resort estimate from model size/precision. This is only
    // used when a registry record has no VRAM figure at all.
    const billionMatch = id.match(/(?:-|^)(\d+(?:\.\d+)?)b(?:-|_|$)/i);
    const billions = billionMatch ? Number(billionMatch[1]) : null;

    if (billions) {
        let bytesPerParameter = 0.5;
        if (/bf16|f16|fp16/.test(id)) bytesPerParameter = 2;
        else if (/q8|int8/.test(id)) bytesPerParameter = 1;
        else if (/q6/.test(id)) bytesPerParameter = 0.78;
        else if (/q5/.test(id)) bytesPerParameter = 0.68;
        else if (/q4/.test(id)) bytesPerParameter = 0.55;
        else if (/q3/.test(id)) bytesPerParameter = 0.45;
        else if (/q2/.test(id)) bytesPerParameter = 0.36;

        // Leave room for runtime/KV cache beyond the raw weights.
        const weightsMB = billions * 1000 * bytesPerParameter;
        const runtimeMB = Math.max(256, weightsMB * 0.18);
        return {
            value: Math.ceil(weightsMB + runtimeMB),
            estimated: true,
            source: "calculated estimate"
        };
    }

    return null;
}

function modelDisplayName(record) {
    return String(record.model_id || "Unknown model")
        .replace(/-q[0-9a-z_]+(?:-MLC)?(?:-\d+k)?$/i, "")
        .replace(/-MLC$/i, "")
        .replace(/_/g, " ");
}

function modelDescription(record) {
    const id = String(record.model_id || "").toLowerCase();

    if (isVisionRecord(record)) {
        return "Vision-language model capable of understanding images alongside text.";
    }
    if (id.includes("coder")) return "Code-focused local model for programming and technical tasks.";
    if (id.includes("math")) return "Math-focused local instruction model.";
    if (id.includes("reasoning") || id.includes("r1")) return "Reasoning-focused local model.";
    if (id.includes("smollm")) return "Small, fast model designed for lower-memory devices.";
    if (id.includes("hermes")) return "Instruction-following assistant model.";
    if (id.includes("gemma")) return "Google Gemma model for general-purpose tasks.";
    if (id.includes("phi")) return "Microsoft Phi model for compact local inference.";
    if (id.includes("qwen")) return "Qwen family model for general-purpose local inference.";
    if (id.includes("llama")) return "Meta Llama model for general-purpose local inference.";
    if (id.includes("ministral")) return "Mistral Ministral model designed for efficient edge/local inference.";
    return "Local WebLLM model.";
}

const ALL_MODELS = REGISTRY
    .filter(record => record && record.model_type !== ModelType.embedding)
    .map(record => {
        const memory = estimateMissingVRAM(record);
        return {
            id: record.model_id,
            name: modelDisplayName(record),
            desc: modelDescription(record),
            images: isVisionRecord(record),
            vramMB: memory?.value ?? null,
            vramEstimated: memory?.estimated ?? false,
            vramSource: memory?.source ?? null,
            lowResource: Boolean(record.low_resource_required),
            requiredFeatures: Array.isArray(record.required_features)
                ? record.required_features
                : []
        };
    });

function getModel(modelId) {
    return ALL_MODELS.find(m => m.id === modelId);
}

function isVisionModel(modelId) {
    return Boolean(getModel(modelId)?.images);
}

let recentModels = (JSON.parse(localStorage.getItem("local_ai_recent_models")) || [])
    .filter(id => getModel(id));

let currentModel = localStorage.getItem("local_ai_model");

if (!getModel(currentModel)) {
    currentModel = recentModels[0] || ALL_MODELS[0]?.id;
    if (currentModel) {
        localStorage.setItem("local_ai_model", currentModel);
    }
}

let currentModelSort = "alphabetical";

// --- View/UI ---
function switchView(viewName) {
    Object.values(views).forEach(v => v.classList.remove("active-view"));
    views[viewName].classList.add("active-view");
}

document.getElementById("profile-btn").onclick = () => switchView("profile");
document.getElementById("system-prompt-btn").onclick = () => switchView("system");

document.getElementById("profile-textarea").addEventListener("input", (e) => {
    savedProfile = e.target.value;
    localStorage.setItem("local_ai_profile_text", savedProfile);
});

document.getElementById("system-prompt-textarea").addEventListener("input", (e) => {
    savedSysPrompt = e.target.value;
    localStorage.setItem("local_ai_sys_prompt_text", savedSysPrompt);
});

function updateModelSelectDropdown() {
    modelSelect.innerHTML = "";

    recentModels.slice(0, 3).forEach(id => {
        const model = getModel(id);
        if (!model) return;

        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = model.name + (model.images ? " • Images" : "");
        modelSelect.appendChild(opt);
    });

    const exploreOpt = document.createElement("option");
    exploreOpt.value = "explore_all";
    exploreOpt.textContent = "Explore all models...";
    modelSelect.appendChild(exploreOpt);

    modelSelect.value = currentModel;
}

// --- AI Loading ---
async function initAI(modelId) {
    cancelLoadingFlag = false;
    currentModel = modelId;
    localStorage.setItem("local_ai_model", currentModel);

    recentModels = [modelId, ...recentModels.filter(id => id !== modelId)].slice(0, 5);
    localStorage.setItem("local_ai_recent_models", JSON.stringify(recentModels));
    updateModelSelectDropdown();

    const model = getModel(modelId);
    statusMsg.textContent = `Preparing ${model?.name || modelId}...`;
    statusMsg.style.color = "#f5c542";
    cancelLoadBtn.style.display = "block";
    chatMessages.appendChild(loadingContainer);

    setControlsEnabled(false);

    try {
        if (engine) {
            await engine.unload();
            engine = null;
        }

        engine = await CreateMLCEngine(modelId, {
            initProgressCallback: (progress) => {
                if (cancelLoadingFlag) throw new Error("LoadCancelledByUser");
                const percent = Math.round(progress.progress * 100);
                statusMsg.textContent = `Downloading/Loading: ${percent}%`;
                statusMsg.style.color = "#f5c542";
            }
        });

        statusMsg.textContent = `${model?.name || modelId} loaded. Ready when you are!`;
        statusMsg.style.color = "#f5c542";
        cancelLoadBtn.style.display = "none";
        setControlsEnabled(true);
        renderHistorySidebar();
        loadChat(currentChatId);
    } catch (error) {
        if (error.message === "LoadCancelledByUser") {
            statusMsg.textContent = "Loading cancelled. Select a model to start.";
            statusMsg.style.color = "#aaa";
        } else {
            statusMsg.textContent = `Error: ${error.message}`;
            statusMsg.style.color = "#ff8a8a";
        }
        cancelLoadBtn.style.display = "none";
        engine = null;
        setControlsEnabled(false);
    }
}

function setControlsEnabled(enabled) {
    const disabled = !enabled || isBusy;
    userInput.disabled = disabled;
    sendBtn.disabled = disabled;
    attachBtn.disabled = disabled;
}

cancelLoadBtn.onclick = async () => {
    cancelLoadingFlag = true;
    try {
        if (engine) await engine.unload();
    } catch (_) {}
    engine = null;
};

// Model selector now opens one combined model explorer.
modelSelect.addEventListener("change", (e) => {
    if (e.target.value === "explore_all") {
        switchView("explore");
        renderModelExplorer();
        e.target.value = currentModel;
    } else {
        switchView("chat");
        initAI(e.target.value);
    }
});

// --- Model Explorer ---------------------------------------------------------
function formatVRAM(model) {
    if (!Number.isFinite(model.vramMB)) {
        return '<span class="model-resource">GPU memory: not specified by WebLLM</span>';
    }

    const gb = model.vramMB / 1024;
    const estimateText = model.vramEstimated ? " (estimated)" : "";
    return `<span class="model-resource">GPU memory: ~${gb.toFixed(1)} GB${estimateText}</span>`;
}

function createModelCard(model) {
    const card = document.createElement("div");
    card.className = "model-card";

    const imageSupport = model.images
        ? '<span class="model-capability">📷 supports images.</span>'
        : "";

    const lowResource = model.lowResource
        ? '<span class="model-resource">✓ low-resource friendly</span>'
        : "";

    const features = model.requiredFeatures.length
        ? `<span class="model-resource">Requires: ${escapeHtml(model.requiredFeatures.join(", "))}</span>`
        : "";

    card.innerHTML = `
        <h4>${escapeHtml(model.name)}</h4>
        <p>${escapeHtml(model.desc)}</p>
        ${imageSupport}
        ${formatVRAM(model)}
        ${lowResource}
        ${features}
    `;

    card.onclick = () => {
        switchView("chat");
        initAI(model.id);
    };

    return card;
}

function sortModels(models, sortMode) {
    const copy = [...models];

    switch (sortMode) {
        case "gpu_low":
            return copy.sort((a, b) => {
                const av = Number.isFinite(a.vramMB) ? a.vramMB : Infinity;
                const bv = Number.isFinite(b.vramMB) ? b.vramMB : Infinity;
                return av - bv || a.name.localeCompare(b.name);
            });

        case "gpu_high":
            return copy.sort((a, b) => {
                const av = Number.isFinite(a.vramMB) ? a.vramMB : -Infinity;
                const bv = Number.isFinite(b.vramMB) ? b.vramMB : -Infinity;
                return bv - av || a.name.localeCompare(b.name);
            });

        case "images_first":
            return copy.sort((a, b) => {
                if (a.images !== b.images) return Number(b.images) - Number(a.images);
                return a.name.localeCompare(b.name);
            });

        case "alphabetical":
        default:
            return copy.sort((a, b) => a.name.localeCompare(b.name));
    }
}

function renderModelExplorer(filterText = "") {
    const recentGrid = document.getElementById("recent-models-grid");
    const allGrid = document.getElementById("all-models-grid");
    const recentSection = document.getElementById("recent-models-section");

    recentGrid.innerHTML = "";
    allGrid.innerHTML = "";

    const text = filterText.toLowerCase().trim();
    const filtered = ALL_MODELS.filter(m =>
        m.name.toLowerCase().includes(text) ||
        m.desc.toLowerCase().includes(text) ||
        (m.images && "images vision image camera".includes(text))
    );

    const recent = recentModels
        .map(id => getModel(id))
        .filter(Boolean)
        .filter(m => !text || filtered.includes(m));

    if (recent.length > 0 && !text) {
        recentSection.style.display = "block";
        recent.forEach(m => recentGrid.appendChild(createModelCard(m)));
    } else {
        recentSection.style.display = "none";
    }

    const sorted = sortModels(filtered, currentModelSort);
    sorted.forEach(m => allGrid.appendChild(createModelCard(m)));
}

document.getElementById("model-search").addEventListener("input", (e) => {
    renderModelExplorer(e.target.value);
});

document.getElementById("model-sort").addEventListener("change", (e) => {
    currentModelSort = e.target.value;
    renderModelExplorer(document.getElementById("model-search").value);
});

// --- File/image attachment handling ---
attachBtn.onclick = () => fileUpload.click();

fileUpload.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    await addFiles(files);
    fileUpload.value = "";
});

async function addFiles(files) {
    for (const file of files) {
        if (file.type.startsWith("image/")) {
            currentAttachedFiles.push(await prepareImageFile(file));
        } else {
            currentAttachedFiles.push(await prepareTextFile(file));
        }
    }

    renderAttachmentPreview();
}

function prepareImageFile(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            try {
                const canvas = document.createElement("canvas");
                const MAX_SIZE = 1024;

                let width = img.naturalWidth || img.width;
                let height = img.naturalHeight || img.height;

                if (width > MAX_SIZE || height > MAX_SIZE) {
                    const scale = Math.min(MAX_SIZE / width, MAX_SIZE / height);
                    width = Math.round(width * scale);
                    height = Math.round(height * scale);
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, width, height);

                const dataUrl = canvas.toDataURL("image/jpeg", 0.86);

                resolve({
                    name: file.name || "pasted-image.jpg",
                    isImage: true,
                    data: dataUrl
                });
            } finally {
                URL.revokeObjectURL(url);
            }
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error(`Could not read image: ${file.name}`));
        };

        img.src = url;
    });
}

function prepareTextFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (event) => {
            resolve({
                name: file.name,
                isImage: false,
                data: String(event.target.result || "")
            });
        };

        reader.onerror = () => reject(new Error(`Could not read file: ${file.name}`));
        reader.readAsText(file);
    });
}

// Paste images/screenshots directly into the chat input.
userInput.addEventListener("paste", async (event) => {
    const items = Array.from(event.clipboardData?.items || []);
    const imageItems = items.filter(item => item.type.startsWith("image/"));

    if (!imageItems.length) return;

    const imageFiles = imageItems
        .map(item => item.getAsFile())
        .filter(Boolean);

    if (imageFiles.length) {
        event.preventDefault();
        await addFiles(imageFiles);
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
            const img = document.createElement("img");
            img.src = file.data;
            img.alt = file.name;
            pill.appendChild(img);
        }

        const span = document.createElement("span");
        span.textContent = `${file.isImage ? "📷 " : "📎 "}${file.name}`;
        pill.appendChild(span);

        attachmentList.appendChild(pill);
    });

    attachmentPreview.style.display = "flex";
}

function clearAttachments() {
    currentAttachedFiles = [];
    fileUpload.value = "";
    attachmentList.innerHTML = "";
    attachmentPreview.style.display = "none";
}

removeAttachmentBtn.onclick = clearAttachments;

// --- Chat UI ---
function appendMessageToUI(role, text, msgId = null, metricsHtml = "", attachments = []) {
    const container = document.createElement("div");
    container.className = `message-container ${role === "user" ? "user" : "ai"}`;

    const msgDiv = document.createElement("div");
    msgDiv.className = `message ${role === "user" ? "user-msg" : "ai-msg"}`;

    if (attachments?.length) {
        attachments.forEach(att => {
            if (att.isImage) {
                const imgPreview = document.createElement("img");
                imgPreview.src = att.data;
                imgPreview.className = "chat-image-preview";
                imgPreview.alt = att.name;
                msgDiv.appendChild(imgPreview);
            } else {
                const attachPill = document.createElement("div");
                attachPill.className = "attachment-pill";
                attachPill.textContent = `📎 ${att.name}`;
                msgDiv.appendChild(attachPill);
                msgDiv.appendChild(document.createElement("br"));
            }
        });
    }

    const textNode = document.createTextNode(text);
    msgDiv.appendChild(textNode);

    if (msgId) msgDiv.id = msgId;
    container.appendChild(msgDiv);

    if (metricsHtml) {
        const metricsDiv = document.createElement("div");
        metricsDiv.className = "metrics";
        metricsDiv.innerHTML = metricsHtml;
        container.appendChild(metricsDiv);
    }

    chatMessages.appendChild(container);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function saveChatToLocal() {
    if (!currentMessages.length) return;

    try {
        chats[currentChatId] = currentMessages;
        localStorage.setItem("local_ai_chats", JSON.stringify(chats));
    } catch (e) {
        console.error("Storage error (might be full):", e);
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

        const titleSpan = document.createElement("span");
        titleSpan.className = "chat-title";

        const firstMsgText = chats[id][0]?.displayContent || "New Chat";
        titleSpan.textContent = firstMsgText;

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "delete-btn";
        deleteBtn.innerHTML = "&times;";
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            delete chats[id];
            localStorage.setItem("local_ai_chats", JSON.stringify(chats));
            if (currentChatId === id) newChatBtn.click();
            else renderHistorySidebar();
        };

        item.appendChild(titleSpan);
        item.appendChild(deleteBtn);
        historyList.appendChild(item);
    });
}

function loadChat(id) {
    currentChatId = id;
    currentMessages = chats[id] || [];
    chatMessages.innerHTML = "";
    chatMessages.appendChild(loadingContainer);

    currentMessages.forEach(msg => {
        if (msg.role === "user" && msg.attachments?.length) {
            appendMessageToUI("user", msg.displayContent, null, "", msg.attachments);
        } else {
            appendMessageToUI(msg.role, msg.displayContent || msg.content);
        }
    });

    renderHistorySidebar();
}

newChatBtn.onclick = () => {
    switchView("chat");
    currentChatId = Date.now().toString();
    currentMessages = [];
    loadChat(currentChatId);
};

// --- Send / multimodal processing ---
sendBtn.onclick = async () => {
    const rawInput = userInput.value.trim();

    if ((!rawInput && !currentAttachedFiles.length) || !engine || isBusy) return;

    isBusy = true;
    setControlsEnabled(false);

    const attachments = currentAttachedFiles.map(file => ({
        name: file.name,
        isImage: file.isImage,
        data: file.isImage ? file.data : undefined,
        ...(file.isImage ? {} : { data: file.data })
    }));

    const hasImages = attachments.some(a => a.isImage);
    const hasVisionModel = isVisionModel(currentModel);

    if (hasImages && !hasVisionModel) {
        isBusy = false;
        setControlsEnabled(true);
        alert(`"${getModel(currentModel)?.name || currentModel}" does not support images. Select a model marked "📷 supports images." in Explore all models.`);
        return;
    }

    const displayText = rawInput || (
        hasImages
            ? `Please analyze ${attachments.filter(a => a.isImage).length > 1 ? "these images" : "this image"} in detail.`
            : "Please analyze these files."
    );

    const storedAttachments = attachments.map(a => ({
        name: a.name,
        isImage: a.isImage,
        data: a.isImage ? a.data : undefined
    }));

    const messageObj = {
        role: "user",
        content: null,
        promptText: rawInput || "",
        displayContent: displayText,
        attachments: storedAttachments
    };

    userInput.value = "";
    clearAttachments();

    currentMessages.push(messageObj);
    appendMessageToUI("user", displayText, null, "", storedAttachments);
    saveChatToLocal();

    const replyId = "reply-" + Date.now();
    const metricId = `metric-${replyId}`;

    appendMessageToUI(
        "assistant",
        "...",
        replyId,
        `<span id="${metricId}">${hasImages ? "Thinking" : "Generating..."}</span>`
    );

    const replyDiv = document.getElementById(replyId);
    const metricSpan = document.getElementById(metricId);
    const startTime = performance.now();

    try {
        const memCtx = savedProfile.trim() ? `User info: ${savedProfile}. ` : "";
        const sysInstruction =
            `${savedSysPrompt}

${memCtx}
` +
            `RULE: If the user tells you a new fact about themselves, silently append it ` +
            `at the very end of your response inside <memory> tags, exactly like ` +
            `<memory>fact</memory>.`;

        // Build a single multimodal user message when images are present.
        // Text files are inserted as plain text context.
        let userContent;

        const promptParts = [];

        if (rawInput) {
            promptParts.push({ type: "text", text: rawInput });
        } else if (hasImages) {
            promptParts.push({
                type: "text",
                text: attachments.filter(a => a.isImage).length > 1
                    ? "Analyze each attached image carefully. Discuss them separately and in order."
                    : "Describe and analyze this image in detail."
            });
        } else {
            promptParts.push({ type: "text", text: "Please analyze the attached files." });
        }

        for (const attachment of attachments) {
            if (attachment.isImage) {
                promptParts.push({
                    type: "image_url",
                    image_url: { url: attachment.data }
                });
            } else {
                promptParts.push({
                    type: "text",
                    text: `\n\n--- Attached File: ${attachment.name} ---\n${attachment.data}\n--- End of File ---`
                });
            }
        }

        userContent = (hasImages ? promptParts : promptParts.map(p => p.text).join(""));

        const aiReadyMessages = currentMessages
            .slice(-10)
            .map(m => {
                if (m === messageObj) {
                    return { role: "user", content: userContent };
                }
                return { role: m.role, content: messageToModelContent(m) };
            });

        let replyText = "";
        let chunkCount = 0;

        if (hasImages) {
            const stream = await engine.chat.completions.create({
                messages: [{ role: "system", content: sysInstruction }, ...aiReadyMessages],
                stream: true
            });

            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta?.content || "";
                if (!delta) continue;

                replyText += delta;
                chunkCount++;

                metricSpan.textContent = "Thinking";

                let display = replyText;
                if (display.includes("<memory>")) {
                    display = display.split("<memory>")[0];
                }

                replyDiv.textContent = display;
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }

            metricSpan.textContent = "Thinking";
        } else {
            const stream = await engine.chat.completions.create({
                messages: [{ role: "system", content: sysInstruction }, ...aiReadyMessages],
                stream: true
            });

            for await (const chunk of stream) {
                replyText += chunk.choices[0]?.delta?.content || "";

                let display = replyText;
                if (display.includes("<memory>")) {
                    display = display.split("<memory>")[0];
                }

                replyDiv.textContent = display;
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
        }

        const timeSec = (performance.now() - startTime) / 1000;
        const estTokens = Math.max(1, Math.round(replyText.length / 4));
        const finalMetrics = hasImages
            ? `Analysed • ${estTokens} tokens • ${timeSec.toFixed(1)}s`
            : `${estTokens} tokens • ${timeSec.toFixed(1)}s • ${(estTokens / Math.max(timeSec, 0.001)).toFixed(1)} tok/s`;

        metricSpan.textContent = finalMetrics;

        // Parse memory tags.
        const memMatch = /<memory>\s*(.*?)\s*<\/memory>/gi;
        let match;

        while ((match = memMatch.exec(replyText)) !== null) {
            const newFact = match[1].trim();
            if (newFact && !savedProfile.includes(newFact)) {
                savedProfile += (savedProfile.length > 0 ? "\n" : "") + `- ${newFact}`;
                document.getElementById("profile-textarea").value = savedProfile;
                localStorage.setItem("local_ai_profile_text", savedProfile);
            }
        }

        const cleanReply = replyText
            .replace(/<memory>[\s\S]*?<\/memory>/gi, "")
            .trim();

        replyDiv.textContent = cleanReply || "(No text response returned.)";

        currentMessages.push({
            role: "assistant",
            content: cleanReply,
            displayContent: cleanReply
        });

        saveChatToLocal();
    } catch (error) {
        console.error(error);
        replyDiv.textContent = `Generation failed: ${error?.message || "unknown error"}`;
        metricSpan.textContent = hasImages
            ? "Image analysis failed"
            : "Generation failed";
    } finally {
        isBusy = false;
        setControlsEnabled(true);
        userInput.focus();
    }
};

userInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendBtn.click();
});

// --- Utilities ---
function messageToModelContent(message) {
    if (message.role !== "user" || !message.attachments?.length) {
        return message.content || message.displayContent || "";
    }

    const parts = [];
    const text = message.promptText || message.displayContent || "";

    if (text) parts.push({ type: "text", text });

    for (const attachment of message.attachments) {
        if (attachment.isImage && attachment.data) {
            parts.push({
                type: "image_url",
                image_url: { url: attachment.data }
            });
        } else if (!attachment.isImage && attachment.data) {
            parts.push({
                type: "text",
                text: `\\n\\n--- Attached File: ${attachment.name} ---\\n${attachment.data}\\n--- End of File ---`
            });
        }
    }

    return parts.some(part => part.type === "image_url")
        ? parts
        : parts.map(part => part.text || "").join("");
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

// --- Boot ---
updateModelSelectDropdown();
renderModelExplorer();
initAI(currentModel);
