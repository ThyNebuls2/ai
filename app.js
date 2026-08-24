import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm";

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
const attachBtn = document.getElementById('attach-btn');
const fileUpload = document.getElementById('file-upload');
const attachmentPreview = document.getElementById('attachment-preview');

let engine;
let currentChatId = Date.now().toString();
let chats = JSON.parse(localStorage.getItem('local_ai_chats')) || {};
let currentMessages = chats[currentChatId] || [];
let cancelLoadingFlag = false;
let currentAttachedFiles = []; // Now handles multiple files

let savedProfile = localStorage.getItem('local_ai_profile_text') || "";
let savedSysPrompt = localStorage.getItem('local_ai_sys_prompt_text') || "You are a helpful, private AI assistant.";
document.getElementById('profile-textarea').value = savedProfile;
document.getElementById('system-prompt-textarea').value = savedSysPrompt;

const TEXT_MODELS = [
    { id: "SmolLM-135M-Instruct-q4f16_1-MLC", name: "SmolLM (135M)", desc: "Ultra-fast, instant responses." },
    { id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC", name: "Qwen 2.5 (0.5B)", desc: "Lightning fast, tiny VRAM footprint." },
    { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", name: "Llama 3.2 (1B)", desc: "Very fast and highly capable." }
];

const VISION_MODELS = [
    { id: "Qwen2-VL-2B-Instruct-q4f16_1-MLC", name: "Qwen2-VL (2B)", desc: "Lightweight, fast image recognition." }
];

const ALL_MODELS = [...TEXT_MODELS, ...VISION_MODELS];
let recentModels = JSON.parse(localStorage.getItem('local_ai_recent_models')) || ["SmolLM-135M-Instruct-q4f16_1-MLC"];
let currentModel = localStorage.getItem('local_ai_model') || recentModels[0];

function isVisionModel(modelId) { return VISION_MODELS.some(m => m.id === modelId); }

function switchView(viewName) {
    Object.values(views).forEach(v => v.classList.remove('active-view'));
    views[viewName].classList.add('active-view');
}
document.getElementById('profile-btn').onclick = () => switchView('profile');
document.getElementById('system-prompt-btn').onclick = () => switchView('system');
document.getElementById('vision-explore-btn').onclick = () => { switchView('visionExplore'); renderVisionExplorer(); };
document.getElementById('clear-chat-btn').onclick = () => { currentMessages = []; chatMessages.innerHTML = ''; saveChatToLocal(); };

// Listeners
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
    exploreOpt.value = "explore_all"; exploreOpt.textContent = "Explore models...";
    modelSelect.appendChild(exploreOpt);
    modelSelect.value = currentModel;
}

async function initAI(modelId) {
    cancelLoadingFlag = false; currentModel = modelId; localStorage.setItem('local_ai_model', currentModel);
    recentModels = [modelId, ...recentModels.filter(id => id !== modelId)].slice(0, 5);
    localStorage.setItem('local_ai_recent_models', JSON.stringify(recentModels));
    updateModelSelectDropdown();

    statusMsg.textContent = `Preparing ${ALL_MODELS.find(m => m.id === modelId)?.name || modelId}...`;
    cancelLoadBtn.style.display = 'block'; chatMessages.appendChild(loadingContainer);
    userInput.disabled = true; sendBtn.disabled = true; attachBtn.disabled = true;
    
    try {
        if (engine) await engine.unload();
        engine = await CreateMLCEngine(modelId, {
            initProgressCallback: (progress) => {
                if (cancelLoadingFlag) throw new Error("LoadCancelled");
                statusMsg.textContent = `Downloading/Loading: ${Math.round(progress.progress * 100)}%`;
            }
        });
        statusMsg.textContent = "AI loaded, ready when you are!";
        cancelLoadBtn.style.display = 'none';
        userInput.disabled = false; sendBtn.disabled = false; attachBtn.disabled = false;
        renderHistorySidebar(); loadChat(currentChatId);
    } catch (error) {
        statusMsg.textContent = error.message === "LoadCancelled" ? "Cancelled." : `Error: ${error.message}`;
        cancelLoadBtn.style.display = 'none'; engine = null;
    }
}
cancelLoadBtn.onclick = () => { cancelLoadingFlag = true; if (engine) engine.unload(); };
modelSelect.addEventListener('change', (e) => {
    if (e.target.value === "explore_all") { switchView('explore'); renderTextExplorer(); e.target.value = currentModel; } 
    else { switchView('chat'); initAI(e.target.value); }
});

function createModelCard(model) {
    const card = document.createElement('div');
    card.className = 'model-card';
    card.innerHTML = `<h4>${model.name}</h4><p>${model.desc}</p>`;
    card.onclick = () => { switchView('chat'); initAI(model.id); };
    return card;
}
function renderTextExplorer(filterText = "") { /* Implementation remains identical */ }
function renderVisionExplorer() { /* Implementation remains identical */ }

// --- FILE UPLOAD & CLIPBOARD ---
attachBtn.onclick = () => fileUpload.click();

async function processFile(file) {
    const isImage = file.type.startsWith('image/');
    if (isImage && !isVisionModel(currentModel)) {
        if (confirm("Uploading an image requires the vision model. Load it now?")) {
            switchView('chat'); await initAI(VISION_MODELS[0].id);
        } else return null;
    }
    
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            if (isImage) {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const MAX = 800; let w = img.width, h = img.height;
                    if (w > MAX || h > MAX) { if (w > h) { h *= MAX/w; w = MAX; } else { w *= MAX/h; h = MAX; } }
                    canvas.width = w; canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    resolve({ name: file.name, isImage: true, data: canvas.toDataURL('image/jpeg', 0.85) });
                };
                img.src = e.target.result;
            } else resolve({ name: file.name, isImage: false, data: e.target.result });
        };
        isImage ? reader.readAsDataURL(file) : reader.readAsText(file);
    });
}

function updateAttachmentUI() {
    attachmentPreview.innerHTML = '';
    if (currentAttachedFiles.length === 0) { attachmentPreview.style.display = 'none'; return; }
    
    currentAttachedFiles.forEach((fileObj, index) => {
        const item = document.createElement('div');
        item.className = 'preview-item';
        if (fileObj.isImage) {
            const img = document.createElement('img'); img.src = fileObj.data; item.appendChild(img);
        }
        const span = document.createElement('span'); span.textContent = fileObj.name; item.appendChild(span);
        const delBtn = document.createElement('button'); delBtn.innerHTML = '&times;';
        delBtn.onclick = () => { currentAttachedFiles.splice(index, 1); updateAttachmentUI(); };
        item.appendChild(delBtn); attachmentPreview.appendChild(item);
    });
    attachmentPreview.style.display = 'flex';
}

fileUpload.addEventListener('change', async (e) => {
    for (let file of e.target.files) {
        const processed = await processFile(file);
        if (processed) currentAttachedFiles.push(processed);
    }
    updateAttachmentUI();
});

document.addEventListener('paste', async (e) => {
    if (!e.clipboardData || !e.clipboardData.files.length) return;
    for (let file of e.clipboardData.files) {
        const processed = await processFile(file);
        if (processed) currentAttachedFiles.push(processed);
    }
    updateAttachmentUI();
});

// --- CHAT LOGIC ---
function appendMessageToUI(role, text, msgId = null, metricsHtml = "", attachments = []) {
    const container = document.createElement('div');
    container.className = `message-container ${role === 'user' ? 'user' : 'ai'}`;
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role === 'user' ? 'user-msg' : 'ai-msg'}`;
    
    attachments.forEach(att => {
        if (att.isImage) {
            const img = document.createElement('img'); img.src = att.data; img.className = 'chat-image-preview'; msgDiv.appendChild(img);
        } else {
            const pill = document.createElement('div'); pill.className = 'attachment-pill'; pill.innerHTML = `📎 ${att.name}`; msgDiv.appendChild(pill);
        }
    });
    
    msgDiv.appendChild(document.createTextNode(text));
    if (msgId) msgDiv.id = msgId;
    container.appendChild(msgDiv);
    
    if (metricsHtml) {
        const met = document.createElement('div'); met.className = 'metrics'; met.innerHTML = metricsHtml; container.appendChild(met);
    }
    chatMessages.appendChild(container); chatMessages.scrollTop = chatMessages.scrollHeight;
}

function saveChatToLocal() { if (currentMessages.length > 0) { chats[currentChatId] = currentMessages; localStorage.setItem('local_ai_chats', JSON.stringify(chats)); renderHistorySidebar(); } }
function renderHistorySidebar() { /* Implementation remains identical */ }
function loadChat(id) { /* Implementation remains identical */ }
newChatBtn.onclick = () => { switchView('chat'); currentChatId = Date.now().toString(); currentMessages = []; loadChat(currentChatId); };

sendBtn.onclick = async () => {
    const rawInput = userInput.value.trim();
    if ((!rawInput && currentAttachedFiles.length === 0) || !engine) return;
    
    let textToDisplay = rawInput;
    let payloadContent = [];
    
    if (rawInput) payloadContent.push({ type: "text", text: rawInput });
    
    currentAttachedFiles.forEach(att => {
        if (att.isImage) payloadContent.push({ type: "image_url", image_url: { url: att.data } });
        else payloadContent.push({ type: "text", text: `\n\n--- File: ${att.name} ---\n${att.data}\n--- End ---` });
    });
    
    if (payloadContent.length === 1 && payloadContent[0].type === "text") payloadContent = rawInput;

    userInput.value = ''; userInput.disabled = true; sendBtn.disabled = true; attachBtn.disabled = true;
    
    const messageObj = { role: "user", content: payloadContent, displayContent: textToDisplay || "Attached File(s)", attachments: [...currentAttachedFiles] };
    currentMessages.push(messageObj);
    appendMessageToUI("user", textToDisplay || "Attached File(s)", null, "", currentAttachedFiles);
    
    currentAttachedFiles = []; updateAttachmentUI(); saveChatToLocal();
    
    const replyId = "reply-" + Date.now();
    appendMessageToUI("assistant", "...", replyId, `<span id="metric-${replyId}">Generating...</span>`);
    const replyDiv = document.getElementById(replyId); const metricSpan = document.getElementById(`metric-${replyId}`);
    
    const startTime = performance.now();
    try {
        const memCtx = savedProfile.trim() ? `User info: ${savedProfile}. ` : "";
        const sysInstruction = `${savedSysPrompt}\n\n${memCtx}\nRULE: If the user tells you a new fact about themselves, you must silently append it at the very end of your response inside <memory> tags.`;
        
        const aiReadyMessages = currentMessages.map(m => ({ role: m.role, content: m.content }));
        
        const stream = await engine.chat.completions.create({
            messages: [{ role: "system", content: sysInstruction }, ...aiReadyMessages.slice(-10)], stream: true,
        });
        
        let replyText = "";
        for await (const chunk of stream) {
            replyText += chunk.choices[0]?.delta.content || "";
            replyDiv.textContent = replyText.includes('<memory>') ? replyText.split('<memory>')[0] : replyText;
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
        
        const timeSec = (performance.now() - startTime) / 1000;
        metricSpan.textContent = `${(replyText.length / 4).toFixed(0)} tokens • ${timeSec.toFixed(1)}s`;
        
        const cleanReply = replyText.replace(/<memory>[\s\S]*?<\/memory>/gi, '').trim();
        replyDiv.textContent = cleanReply;
        currentMessages.push({ role: "assistant", content: cleanReply, displayContent: cleanReply }); saveChatToLocal();
    } catch (e) {
        replyDiv.textContent = "Generation failed."; console.error(e);
    }
    
    userInput.disabled = false; sendBtn.disabled = false; attachBtn.disabled = false; userInput.focus();
};
userInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendBtn.click(); });

updateModelSelectDropdown();
initAI(currentModel);
