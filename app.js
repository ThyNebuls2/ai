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
// Complete WebLLM model catalogue
// Show every prebuilt chat/vision model shipped with this exact WebLLM build.
// Embedding-only models are excluded because they are not chat models.
// -----------------------------------------------------------------------------
const PREBUILT_RECORDS = prebuiltAppConfig.model_list;
const PREBUILT_BY_ID = new Map(PREBUILT_RECORDS.map(record => [record.model_id, record]));

const CATALOG_RECORDS = PREBUILT_RECORDS.filter(
    record => record.model_type !== ModelType.embedding
);

function isVisionRecord(record) {
    return record?.model_type === ModelType.VLM;
}

function makeModelDescription(record) {
    const id = record.model_id.toLowerCase();
    if (isVisionRecord(record)) return "Vision-language model for image understanding and visual question answering.";
    if (id.includes("coder")) return "Code-focused model for programming and technical tasks.";
    if (id.includes("math")) return "Math-focused instruction model.";
    if (id.includes("reasoning") || id.includes("deepseek")) return "Reasoning-focused model for more difficult tasks.";
    if (id.includes("hermes")) return "Instruction-following assistant model.";
    if (id.includes("mistral")) return "General-purpose instruction model.";
    if (id.includes("phi")) return "Compact Microsoft model for general-purpose tasks.";
    if (id.includes("qwen")) return "Qwen model for general-purpose language tasks.";
    if (id.includes("llama")) return "Meta Llama model for general-purpose language tasks.";
    if (id.includes("gemma")) return "Google Gemma model for general-purpose language tasks.";
    if (id.includes("tinyllama")) return "Very small model designed for low-resource devices.";
    return "Local WebLLM chat model.";
}

const ALL_MODELS = CATALOG_RECORDS.map(record => ({
    id: record.model_id,
    name: record.model_id
        .replace(/-q4f16_1-MLC(-1k)?$/i, "")
        .replace(/-q4f32_1-MLC(-1k)?$/i, "")
        .replace(/-q0f16-MLC(-1k)?$/i, "")
        .replace(/-q0f32-MLC(-1k)?$/i, ""),
    desc: makeModelDescription(record),
    images: isVisionRecord(record),
    lowResource: Boolean(record.low_resource_required),
    vramMB: record.vram_required_MB || null,
    requiredFeatures: record.required_features || []
}));

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
        ${model.vramMB ? `<span class="model-resource">~${(model.vramMB / 1024).toFixed(1)} GB GPU memory</span>` : ""}
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
                // Phi-3.5 Vision's processor resolves 1344x1008 (W x H) to
                // 1921 image tokens. The transposed 1008x1344 case resolves
                // to 1933 tokens and causes the compiled WebLLM model to fail.
                const TARGET_WIDTH = 1344;
                const TARGET_HEIGHT = 1008;

                const canvas = document.createElement("canvas");
                canvas.width = TARGET_WIDTH;
                canvas.height = TARGET_HEIGHT;

                const ctx = canvas.getContext("2d", { alpha: false });
                if (!ctx) throw new Error("Could not create image canvas.");

                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);

                const scale = Math.min(
                    TARGET_WIDTH / image.naturalWidth,
                    TARGET_HEIGHT / image.naturalHeight
                );

                const drawWidth = Math.max(1, Math.round(image.naturalWidth * scale));
                const drawHeight = Math.max(1, Math.round(image.naturalHeight * scale));
                const offsetX = Math.round((TARGET_WIDTH - drawWidth) / 2);
                const offsetY = Math.round((TARGET_HEIGHT - drawHeight) / 2);

                ctx.drawImage(
                    image,
                    offsetX,
                    offsetY,
                    drawWidth,
                    drawHeight
                );

                const dataUrl = canvas.toDataURL("image/jpeg", 0.72);

                resolve({
                    name: file.name || "pasted-image.jpg",
                    isImage: true,
                    data: dataUrl
                });
            } catch (error) {
                reject(
                    new Error(
                        `Could not process image: ${file.name || "pasted image"}`
                    )
                );
            } finally {
                URL.revokeObjectURL(url);
            }
        };

        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(
                new Error(
                    `Could not read image: ${file.name || "pasted image"}`
                )
            );
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

    if ((!rawInput && !currentAttachedFiles.length) || !engine || isBusy) {
        return;
    }

    const attachments = currentAttachedFiles.map(file => ({
        name: file.name,
        isImage: file.isImage,
        data: file.data
    }));

    const hasImages = attachments.some(file => file.isImage);

    if (hasImages && !isVisionModel(currentModel)) {
        alert(
            `"${getModel(currentModel)?.name || currentModel}" does not support images. Select a model marked "📷 supports images." in Explore all models.`
        );
        return;
    }

    isBusy = true;
    setControlsEnabled(false);

    const displayText = rawInput || (
        attachments.length > 1
            ? "Please analyze the attached files."
            : hasImages
                ? "Please analyze this image in detail."
                : "Please analyze this file."
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

    appendMessageToUI(
        "user",
        displayText,
        null,
        "",
        storedAttachments
    );

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
        const memCtx = savedProfile.trim()
            ? `User info: ${savedProfile}. `
            : "";

        const sysInstruction =
            `${savedSysPrompt}\n\n${memCtx}` +
            "RULE: If the user tells you a new fact about themselves, silently append it at the very end of your response inside <memory> tags, exactly like <memory>fact</memory>.";

        // Process each attachment independently. In Phi-3.5 Vision's compiled
        // WebLLM path, one image already consumes ~1921 prefill tokens, leaving
        // too little room to safely embed a second image in the same request.
        const jobs = attachments.length
            ? attachments
            : [{ name: "", isImage: false, data: null }];

        const outputs = [];

        for (let index = 0; index < jobs.length; index++) {
            const attachment = jobs[index];

            if (attachment.isImage) {
                metricSpan.textContent =
                    `Analysing Image: ${Math.round((index / jobs.length) * 100)}%`;
                await nextFrame();
            }

            const parts = [];

            if (rawInput) {
                parts.push({ type: "text", text: rawInput });
            } else if (attachment.isImage) {
                parts.push({
                    type: "text",
                    text: "Describe and analyze this image in detail."
                });
            } else if (attachment.data !== null) {
                parts.push({
                    type: "text",
                    text: "Please analyze this attached file."
                });
            } else {
                parts.push({
                    type: "text",
                    text: rawInput || "Hello."
                });
            }

            if (attachment.isImage) {
                parts.push({
                    type: "image_url",
                    image_url: { url: attachment.data }
                });
            } else if (attachment.data !== null) {
                parts.push({
                    type: "text",
                    text:
                        `\n\n--- Attached File: ${attachment.name} ---\n${attachment.data}\n--- End of File ---`
                });
            }

            // Previous uploaded images are deliberately reduced to their text
            // description in history. This guarantees one image maximum in the
            // VLM request even on later turns of the same conversation.
            const history = currentMessages
                .slice(0, -1)
                .slice(-10)
                .map(message => ({
                    role: message.role,
                    content: messageToModelContent(message)
                }));

            const stream = await engine.chat.completions.create({
                messages: [
                    { role: "system", content: sysInstruction },
                    ...history,
                    { role: "user", content: parts }
                ],
                stream: true
            });

            let replyText = "";
            let chunkCount = 0;

            for await (const chunk of stream) {
                replyText += chunk.choices[0]?.delta?.content || "";
                chunkCount++;

                if (attachment.isImage) {
                    // WebLLM does not expose the private vision-encoder progress
                    // counter, so this reflects actual streamed inference and
                    // reserves completion for 100%.
                    const localProgress = Math.min(95, Math.round(
                        15 + 80 * (1 - Math.exp(-chunkCount / 16))
                    ));

                    const overall =
                        (index / jobs.length) * 100 +
                        localProgress / jobs.length;

                    metricSpan.textContent =
                        `Analysing Image: ${Math.round(overall)}%`;
                }

                const visibleText = stripMemoryTagFromStream(replyText);

                if (jobs.length === 1) {
                    replyDiv.textContent = visibleText;
                } else {
                    const liveOutputs = [...outputs, visibleText];
                    replyDiv.textContent = liveOutputs
                        .map((text, outputIndex) =>
                            `### ${jobs[outputIndex].name || `Response ${outputIndex + 1}`}\n${text}`
                        )
                        .join("\n\n");
                }

                chatMessages.scrollTop = chatMessages.scrollHeight;
            }

            outputs.push(
                replyText
                    .replace(/<memory>[\s\S]*?<\/memory>/gi, "")
                    .trim()
            );

            updateMemoryFromReply(replyText);

            if (attachment.isImage) {
                metricSpan.textContent =
                    `Analysing Image: ${Math.round(((index + 1) / jobs.length) * 100)}%`;
            }
        }

        const finalReply = outputs
            .map((text, index) =>
                jobs.length === 1
                    ? text
                    : `### ${jobs[index].name || `Response ${index + 1}`}\n${text}`
            )
            .join("\n\n")
            .trim();

        replyDiv.textContent = finalReply || "(No text response returned.)";

        const timeSec = Math.max(
            (performance.now() - startTime) / 1000,
            0.001
        );

        const estTokens = Math.max(
            1,
            Math.round(finalReply.length / 4)
        );

        metricSpan.textContent = hasImages
            ? `Analysed • ${estTokens} tokens • ${timeSec.toFixed(1)}s`
            : `${estTokens} tokens • ${timeSec.toFixed(1)}s • ${(estTokens / timeSec).toFixed(1)} tok/s`;

        currentMessages.push({
            role: "assistant",
            content: finalReply,
            displayContent: finalReply
        });

        saveChatToLocal();

    } catch (error) {
        console.error(error);

        replyDiv.textContent =
            `Generation failed: ${error?.message || "unknown error"}`;

        metricSpan.textContent = hasImages
            ? "Image analysis failed"
            : "Generation failed";
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
    if (message.role === "user" && message.attachments?.length) {
        // Do not resend old image binaries to a Phi-3.5 Vision request. The
        // current image is embedded separately; history stays text-only.
        const prompt = message.promptText || message.displayContent || "";
        const names = message.attachments
            .map(attachment => attachment.name)
            .filter(Boolean)
            .join(", ");

        return names
            ? `${prompt}${prompt ? "\n" : ""}[Previously attached: ${names}]`
            : prompt;
    }

    return message.content || message.displayContent || "";
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
