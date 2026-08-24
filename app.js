import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm";

// --- DOM Elements ---
const views = {
    chat: document.getElementById('chat-view'),
    profile: document.getElementById('profile-view'),
    system: document.getElementById('system-prompt-view'),
    explore: document.getElementById('explore-view'),
    visionExplore: document.getElementById('vision-explore-view')
};
const chatMessages = document.getElementById('chat-messages');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const newChatBtn = document.getElementById('new-chat-btn');
const historyList = document.getElementById('history-list');
const statusMsg = document.getElementById('status-msg');
const cancelLoadBtn = document.getElementById('cancel-load-btn');
const loadingContainer = document.getElementById('loading-container');
const modelSelect = document.getElementById('model-select');
const visionExploreBtn = document.getElementById('vision-explore-btn');

// File Upload Elements
const attachBtn = document.getElementById('attach-btn');
const fileUpload = document.getElementById('file-upload');
const attachmentPreview = document.getElementById('attachment-preview');
const attachmentName = document.getElementById('attachment-name');
const imageThumbnail = document.getElementById('image-thumbnail');
const removeAttachmentBtn = document.getElementById('remove-attachment-btn');

// --- Global State ---
let engine;
let currentChatId = Date.now().toString();
let chats = JSON.parse(localStorage.getItem('local_ai_chats')) || {};
let currentMessages = chats[currentChatId] || [];
let cancelLoadingFlag = false;

let currentAttachedFile = null;
let currentAttachedFileData = ""; // Holds text or Base64 image
let isAttachedFileImage = false;

// Settings
let savedProfile = localStorage.getItem('local_ai_profile_text') || "";
let savedSysPrompt = localStorage.getItem('local_ai_sys_prompt_text') || "You are a helpful, private AI assistant.";
document.getElementById('profile-textarea').value = savedProfile;
document.getElementById('system-prompt-textarea').value = savedSysPrompt;

// --- Model Catalogs ---
const TEXT_MODELS = [
    { id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC", name: "Qwen 2.5 (0.5B)", desc: "Lightning fast, tiny VRAM footprint." },
    { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", name: "Llama 3.2 (1B)", desc: "Very fast and highly capable." },
    { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", name: "Qwen 2.5 (1.5B)", desc: "Great balance of speed and intelligence." },
    { id: "Gemma-2-2b-it-q4f16_1-MLC", name: "Gemma 2 (2B)", desc: "Google's balanced open model." },
    { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", name: "Llama 3.2 (3B)", desc: "Excellent reasoning, requires decent GPU." },
    { id: "Phi-3.5-mini-instruct-q4f16_1-MLC", name: "Phi-3.5 Mini (3.8B)", desc: "Microsoft's capable reasoning model." },
    { id: "Llama-3.1-8B-Instruct-q4f16_1-MLC", name: "Llama 3.1 (8B)", desc: "Top tier reasoning, needs lots of RAM." }
];

const VISION_MODELS = [
    { id: "Qwen2-VL-2B-Instruct-q4f16_1-MLC", name: "Qwen2-VL (2B)", desc: "Lightweight, fast image recognition. Best for most devices." },
    { id: "Phi-3.5-vision-instruct-q4f16_1-MLC", name: "Phi-3.5 Vision (4B)", desc: "Great visual reasoning and text extraction." },
    { id: "Qwen2-VL-7B-Instruct-q4f16_1-MLC", name: "Qwen2-VL (7B)", desc: "High quality vision model, requires more RAM." },
    { id: "Llama-3.2-11B-Vision-Instruct-q4f16_1-MLC", name: "Llama 3.2 Vision (11B)", desc: "Extremely powerful, requires high-end GPU." }
];

const ALL_MODELS = [...TEXT_MODELS, ...VISION_MODELS];

let recentModels = JSON.parse(localStorage.getItem('local_ai_recent_models')) || ["Llama-3.2-1B-Instruct-q4f16_1-MLC"];
let currentModel = localStorage.getItem('local_ai_model') || recentModels[0];

function isVisionModel(modelId) {
    return VISION_MODELS.some(m => m.id === modelId);
}

// --- Initialization & UI Setup ---

function switchView(viewName) {
    Object.values(views).forEach(v => v.classList.remove('active-view'));
    views[viewName].classList.add('active-view');
}
document.getElementById('profile-btn').onclick = () => switchView('profile');
document.getElementById('system-prompt-btn').onclick = () => switchView('system');
visionExploreBtn.onclick = () => { switchView('visionExplore'); renderVisionExplorer(); };

document.getElementById('profile-textarea').addEventListener('input', (e) => {
    savedProfile = e.target.value; localStorage.setItem('local_ai_profile_text', savedProfile);
});
document.getElementById('system-prompt-textarea').addEventListener('input', (e) => {
    savedSysPrompt = e.target.value; localStorage.setItem('local_ai_sys_prompt_text', savedSysPrompt);
});

function updateModelSelectDropdown() {
    modelSelect.innerHTML = '';
    recentModels.slice(0,3).forEach(id => {
        const m = ALL_MODELS.find(m => m.id === id);
        if (m) {
            const opt = document.createElement('option');
            opt.value = id; opt.textContent = m.name + (isVisionModel(id) ? ' (Vision)' : '');
            modelSelect.appendChild(opt);
        }
    });
    const exploreOpt = document.createElement('option');
    exploreOpt.value = "explore_all"; exploreOpt.textContent = "Explore text models...";
    modelSelect.appendChild(exploreOpt);
    modelSelect.value = currentModel;
}

// --- AI Loading Logic ---

async function initAI(modelId) {
    cancelLoadingFlag = false;
    currentModel = modelId;
    localStorage.setItem('local_ai_model', currentModel);
    
    recentModels = [modelId, ...recentModels.filter(id => id !== modelId)].slice(0, 5);
    localStorage.setItem('local_ai_recent_models', JSON.stringify(recentModels));
    updateModelSelectDropdown();

    statusMsg.textContent = `Preparing ${ALL_MODELS.find(m => m.id === modelId)?.name || modelId}...`;
    statusMsg.style.color = "#a8c7fa";
    cancelLoadBtn.style.display = 'block';
    chatMessages.appendChild(loadingContainer);
    userInput.disabled = true; sendBtn.disabled = true; attachBtn.disabled = true;
    
    try {
        if (engine) await engine.unload();
        
        engine = await CreateMLCEngine(modelId, {
            initProgressCallback: (progress) => {
                if (cancelLoadingFlag) throw new Error("LoadCancelledByUser");
                const percent = Math.round(progress.progress * 100);
                statusMsg.textContent = `Downloading/Loading: ${percent}% (Caches after first load)`;
            }
        });
        
        statusMsg.textContent = "AI loaded, ready when you are!";
        cancelLoadBtn.style.display = 'none';
        userInput.disabled = false; sendBtn.disabled = false; attachBtn.disabled = false;
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
        cancelLoadBtn.style.display = 'none';
        engine = null;
    }
}

cancelLoadBtn.onclick = () => { cancelLoadingFlag = true; if (engine) engine.unload(); };

modelSelect.addEventListener('change', (e) => {
    if (e.target.value === "explore_all") {
        switchView('explore'); renderTextExplorer(); e.target.value = currentModel;
    } else {
        switchView('chat'); initAI(e.target.value);
    }
});

function createModelCard(model) {
    const card = document.createElement('div');
    card.className = 'model-card';
    card.innerHTML = `<h4>${model.name}</h4><p>${model.desc}</p>`;
    card.onclick = () => { switchView('chat'); initAI(model.id); };
    return card;
}

function renderTextExplorer(filterText = "") {
    const recentGrid = document.getElementById('recent-models-grid');
    const allGrid = document.getElementById('all-models-grid');
    const recentSection = document.getElementById('recent-models-section');
    recentGrid.innerHTML = ''; allGrid.innerHTML = '';
    
    const textRecent = recentModels.filter(id => !isVisionModel(id));
    if (textRecent.length > 0 && !filterText) {
        recentSection.style.display = 'block';
        textRecent.forEach(id => {
            const m = TEXT_MODELS.find(m => m.id === id);
            if(m) recentGrid.appendChild(createModelCard(m));
        });
    } else {
        recentSection.style.display = 'none';
    }

    TEXT_MODELS.filter(m => m.name.toLowerCase().includes(filterText.toLowerCase()) || m.desc.toLowerCase().includes(filterText.toLowerCase()))
        .forEach(m => allGrid.appendChild(createModelCard(m)));
}
document.getElementById('model-search').addEventListener('input', (e) => renderTextExplorer(e.target.value));

function renderVisionExplorer() {
    const grid = document.getElementById('vision-models-grid');
    grid.innerHTML = '';
    VISION_MODELS.forEach(m => grid.appendChild(createModelCard(m)));
}

// --- File & Image Attachment Logic ---

attachBtn.onclick = () => fileUpload.click();

fileUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    currentAttachedFile = file;
    isAttachedFileImage = file.type.startsWith('image/');

    if (isAttachedFileImage) {
        // Check if current model is a vision model
        if (!isVisionModel(currentModel)) {
            const loadVLM = confirm("Looks like you're trying to upload an image, would you like to load the image recognition model?");
            if (loadVLM) {
                switchView('chat');
                await initAI(VISION_MODELS[0].id); // Load lightweight Qwen Vision by default
            } else {
                alert("Standard text models cannot process images. Attachment cleared.");
                removeAttachmentBtn.click();
                return;
            }
        }

        // Downscale image using canvas to prevent localStorage limits (5MB) from crashing
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_SIZE = 800; // Max width/height
            let width = img.width; let height = img.height;
            if (width > MAX_SIZE || height > MAX_SIZE) {
                if (width > height) { height *= MAX_SIZE / width; width = MAX_SIZE; }
                else { width *= MAX_SIZE / height; height = MAX_SIZE; }
            }
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            currentAttachedFileData = canvas.toDataURL('image/jpeg', 0.85); // JPEG compression
            
            imageThumbnail.src = currentAttachedFileData;
            imageThumbnail.style.display = 'block';
            attachmentName.textContent = file.name;
            attachmentPreview.style.display = 'flex';
        };
        img.src = URL.createObjectURL(file);

    } else {
        // Process as standard text document
        const reader = new FileReader();
        reader.onload = (event) => {
            currentAttachedFileData = event.target.result;
            imageThumbnail.style.display = 'none';
            attachmentName.textContent = file.name;
            attachmentPreview.style.display = 'flex';
        };
        reader.readAsText(file);
    }
});

removeAttachmentBtn.onclick = () => {
    currentAttachedFile = null;
    currentAttachedFileData = "";
    isAttachedFileImage = false;
    fileUpload.value = "";
    attachmentPreview.style.display = 'none';
    imageThumbnail.src = "";
};

// --- Chat Logic ---

function appendMessageToUI(role, text, msgId = null, metricsHtml = "", attachmentData = null) {
    const container = document.createElement('div');
    container.className = `message-container ${role === 'user' ? 'user' : 'ai'}`;
    
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role === 'user' ? 'user-msg' : 'ai-msg'}`;
    
    if (attachmentData) {
        if (attachmentData.isImage) {
            const imgPreview = document.createElement('img');
            imgPreview.src = attachmentData.data;
            imgPreview.className = 'chat-image-preview';
            msgDiv.appendChild(imgPreview);
        } else {
            const attachPill = document.createElement('div');
            attachPill.className = 'attachment-pill';
            attachPill.innerHTML = `📎 ${attachmentData.name}`;
            msgDiv.appendChild(attachPill);
            msgDiv.appendChild(document.createElement('br'));
        }
    }
    
    const textNode = document.createTextNode(text);
    msgDiv.appendChild(textNode);
    if (msgId) msgDiv.id = msgId;
    container.appendChild(msgDiv);
    
    if (metricsHtml) {
        const metricsDiv = document.createElement('div');
        metricsDiv.className = 'metrics';
        metricsDiv.innerHTML = metricsHtml;
        container.appendChild(metricsDiv);
    }
    chatMessages.appendChild(container);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function saveChatToLocal() {
    if (currentMessages.length > 0) {
        try {
            chats[currentChatId] = currentMessages;
            localStorage.setItem('local_ai_chats', JSON.stringify(chats));
        } catch (e) {
            console.error("Storage error (might be full):", e);
        }
        renderHistorySidebar();
    }
}

function renderHistorySidebar() {
    historyList.innerHTML = '';
    Object.keys(chats).reverse().forEach(id => {
        const item = document.createElement('div');
        item.className = `history-item ${id === currentChatId ? 'active' : ''}`;
        item.onclick = () => { switchView('chat'); loadChat(id); };
        
        const titleSpan = document.createElement('span');
        titleSpan.className = 'chat-title';
        let firstMsgText = chats[id][0]?.displayContent || "New Chat";
        titleSpan.textContent = firstMsgText;
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '&times;';
        deleteBtn.onclick = (e) => {
            e.stopPropagation(); 
            delete chats[id]; localStorage.setItem('local_ai_chats', JSON.stringify(chats));
            if (currentChatId === id) newChatBtn.click(); else renderHistorySidebar();
        };
        item.appendChild(titleSpan); item.appendChild(deleteBtn); historyList.appendChild(item);
    });
}

function loadChat(id) {
    currentChatId = id; currentMessages = chats[id] || [];
    chatMessages.innerHTML = ''; chatMessages.appendChild(loadingContainer);
    
    currentMessages.forEach(msg => {
        if (msg.role === "user" && msg.attachment) {
            appendMessageToUI(msg.role, msg.displayContent, null, "", msg.attachment);
        } else {
            appendMessageToUI(msg.role, msg.displayContent || msg.content);
        }
    });
    renderHistorySidebar();
}

newChatBtn.onclick = () => {
    switchView('chat');
    currentChatId = Date.now().toString(); currentMessages = []; loadChat(currentChatId);
};

sendBtn.onclick = async () => {
    const rawInput = userInput.value.trim();
    if ((!rawInput && !currentAttachedFile) || !engine) return;
    
    let textToDisplay = rawInput;
    let payloadContent = rawInput;
    let attachmentObj = null;

    if (currentAttachedFile) {
        if (isAttachedFileImage) {
            // Format for Vision Language Models (OpenAI spec)
            attachmentObj = { name: currentAttachedFile.name, isImage: true, data: currentAttachedFileData };
            payloadContent = [
                { type: "text", text: rawInput || "Describe this image in detail." },
                { type: "image_url", image_url: { url: currentAttachedFileData } }
            ];
            if (!rawInput) textToDisplay = "Describe this image in detail.";
        } else {
            // Format for Text documents
            attachmentObj = { name: currentAttachedFile.name, isImage: false };
            payloadContent = `${rawInput}\n\n--- Attached File: ${currentAttachedFile.name} ---\n${currentAttachedFileData}\n--- End of File ---`;
            if (!rawInput) textToDisplay = "Please analyze this file.";
        }
    }
    
    userInput.value = ''; userInput.disabled = true; sendBtn.disabled = true; attachBtn.disabled = true;
    
    const messageObj = { 
        role: "user", 
        content: payloadContent, 
        displayContent: textToDisplay,
        attachment: attachmentObj
    };
    currentMessages.push(messageObj);
    appendMessageToUI("user", textToDisplay, null, "", attachmentObj);
    saveChatToLocal();
    
    removeAttachmentBtn.click(); // Clear UI
    
    const replyId = "reply-" + Date.now();
    let initialMetricText = "Generating...";
    
    if (attachmentObj && !attachmentObj.isImage && currentAttachedFileData.length > 1000) {
        const estTokens = currentAttachedFileData.length / 4;
        const estSeconds = Math.max(1, Math.round(estTokens / 150));
        initialMetricText = `Processing file context... (~${estSeconds}s remaining)`;
    } else if (attachmentObj && attachmentObj.isImage) {
        initialMetricText = "Processing vision elements...";
    }
    
    appendMessageToUI("assistant", "...", replyId, `<span id="metric-${replyId}">${initialMetricText}</span>`);
    const replyDiv = document.getElementById(replyId);
    const metricSpan = document.getElementById(`metric-${replyId}`);
    
    const startTime = performance.now();
    try {
        const memCtx = savedProfile.trim() ? `User info: ${savedProfile}. ` : "";
        // Updated instruction for hidden XML tags
        const sysInstruction = `${savedSysPrompt}\n\n${memCtx}\nRULE: If the user tells you a new fact about themselves, you must silently append it at the very end of your response inside <memory> tags, like exactly this: <memory>fact</memory>.`;
        
        const aiReadyMessages = currentMessages.map(m => ({ role: m.role, content: m.content }));
        
        const stream = await engine.chat.completions.create({
            messages: [{ role: "system", content: sysInstruction }, ...aiReadyMessages.slice(-10)],
            stream: true,
        });
        
        let replyText = "";
        for await (const chunk of stream) {
            replyText += chunk.choices[0]?.delta.content || "";
            
            // Visually strip out the memory tag while it's typing so the user never sees it
            let streamDisplay = replyText;
            if (streamDisplay.includes('<memory>')) {
                streamDisplay = streamDisplay.split('<memory>')[0];
            }
            replyDiv.textContent = streamDisplay;
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
        
        const timeSec = (performance.now() - startTime) / 1000;
        const estTokens = Math.max(1, Math.round(replyText.length / 4));
        metricSpan.textContent = `${estTokens} tokens • ${timeSec.toFixed(1)}s • ${(estTokens/timeSec).toFixed(1)} tok/s`;
        
        // Parse the final response for memory tags behind the scenes
        const memMatch = /<memory>\s*(.*?)\s*<\/memory>/gi;
        let match;
        while ((match = memMatch.exec(replyText)) !== null) {
            const newFact = match[1].trim();
            if (!savedProfile.includes(newFact)) {
                savedProfile += (savedProfile.length > 0 ? "\n" : "") + `- ${newFact}`;
                document.getElementById('profile-textarea').value = savedProfile;
                localStorage.setItem('local_ai_profile_text', savedProfile);
            }
        }
        
        // Completely strip the tags before saving to UI and history
        const cleanReply = replyText.replace(/<memory>[\s\S]*?<\/memory>/gi, '').trim();
        replyDiv.textContent = cleanReply;
        
        // We use displayContent to ensure the AI doesn't see its own memory tags in future context
        currentMessages.push({ role: "assistant", content: cleanReply, displayContent: cleanReply });
        saveChatToLocal();
    } catch (e) {
        replyDiv.textContent = "Generation failed. Model may not support this input or you ran out of RAM."; 
        metricSpan.textContent = "Failed";
        console.error(e);
    }
    
    userInput.disabled = false; sendBtn.disabled = false; attachBtn.disabled = false; userInput.focus();
};
userInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendBtn.click(); });

// --- Boot ---
updateModelSelectDropdown();
initAI(currentModel);
