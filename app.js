import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm";

// --- DOM Elements ---
const views = {
    chat: document.getElementById('chat-view'),
    profile: document.getElementById('profile-view'),
    system: document.getElementById('system-prompt-view'),
    explore: document.getElementById('explore-view')
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

// --- Global State ---
let engine;
let currentChatId = Date.now().toString();
let chats = JSON.parse(localStorage.getItem('local_ai_chats')) || {};
let currentMessages = chats[currentChatId] || [];
let cancelLoadingFlag = false;

// Settings
let savedProfile = localStorage.getItem('local_ai_profile_text') || "";
let savedSysPrompt = localStorage.getItem('local_ai_sys_prompt_text') || "You are a helpful, private AI assistant.";
document.getElementById('profile-textarea').value = savedProfile;
document.getElementById('system-prompt-textarea').value = savedSysPrompt;

// --- Model Catalog Data ---
const MODEL_CATALOG = [
    { id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC", name: "Qwen 2.5 (0.5B)", desc: "Lightning fast, tiny VRAM footprint. Best for older devices." },
    { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", name: "Llama 3.2 (1B)", desc: "Very fast and highly capable for its small size." },
    { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", name: "Qwen 2.5 (1.5B)", desc: "Great balance of speed and intelligence." },
    { id: "Gemma-2-2b-it-q4f16_1-MLC", name: "Gemma 2 (2B)", desc: "Google's balanced open model." },
    { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", name: "Llama 3.2 (3B)", desc: "Excellent reasoning, requires decent graphics hardware." },
    { id: "Phi-3.5-mini-instruct-q4f16_1-MLC", name: "Phi-3.5 Mini (3.8B)", desc: "Microsoft's highly capable reasoning model." },
    { id: "Llama-3.1-8B-Instruct-q4f16_1-MLC", name: "Llama 3.1 (8B)", desc: "Top tier reasoning, needs lots of RAM (5GB+)." },
    { id: "Mistral-7B-Instruct-v0.3-q4f16_1-MLC", name: "Mistral 7B (v0.3)", desc: "High quality 7B model." },
    { id: "DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC", name: "DeepSeek R1 (7B)", desc: "Excellent distilled reasoning model." },
    { id: "SmolLM2-360M-Instruct-q4f16_1-MLC", name: "SmolLM2 (360M)", desc: "Tiny, instant startup, low memory." }
];

let recentModels = JSON.parse(localStorage.getItem('local_ai_recent_models')) || ["Llama-3.2-1B-Instruct-q4f16_1-MLC"];
let currentModel = localStorage.getItem('local_ai_model') || recentModels[0];

// --- Initialization & UI Setup ---

function switchView(viewName) {
    Object.values(views).forEach(v => v.classList.remove('active-view'));
    views[viewName].classList.add('active-view');
}
document.getElementById('profile-btn').onclick = () => switchView('profile');
document.getElementById('system-prompt-btn').onclick = () => switchView('system');
document.getElementById('profile-textarea').addEventListener('input', (e) => {
    savedProfile = e.target.value; localStorage.setItem('local_ai_profile_text', savedProfile);
});
document.getElementById('system-prompt-textarea').addEventListener('input', (e) => {
    savedSysPrompt = e.target.value; localStorage.setItem('local_ai_sys_prompt_text', savedSysPrompt);
});

function updateModelSelectDropdown() {
    modelSelect.innerHTML = '';
    // Show only the 3 most recent in the dropdown for brevity
    recentModels.slice(0,3).forEach(id => {
        const modelData = MODEL_CATALOG.find(m => m.id === id);
        if (modelData) {
            const opt = document.createElement('option');
            opt.value = id; opt.textContent = modelData.name;
            modelSelect.appendChild(opt);
        }
    });
    const exploreOpt = document.createElement('option');
    exploreOpt.value = "explore_all"; exploreOpt.textContent = "Explore all...";
    modelSelect.appendChild(exploreOpt);
    modelSelect.value = currentModel;
}

// --- AI Loading & Cancellation Logic ---

async function initAI(modelId) {
    cancelLoadingFlag = false;
    currentModel = modelId;
    localStorage.setItem('local_ai_model', currentModel);
    
    // Update recents list
    recentModels = [modelId, ...recentModels.filter(id => id !== modelId)].slice(0, 5);
    localStorage.setItem('local_ai_recent_models', JSON.stringify(recentModels));
    updateModelSelectDropdown();

    statusMsg.textContent = `Preparing ${MODEL_CATALOG.find(m => m.id === modelId)?.name || modelId}...`;
    statusMsg.style.color = "#a8c7fa";
    cancelLoadBtn.style.display = 'block';
    chatMessages.appendChild(loadingContainer); // Move loader to bottom
    userInput.disabled = true; sendBtn.disabled = true;
    
    try {
        if (engine) await engine.unload(); // Unload previous if exists
        
        engine = await CreateMLCEngine(modelId, {
            initProgressCallback: (progress) => {
                if (cancelLoadingFlag) throw new Error("LoadCancelledByUser");
                const percent = Math.round(progress.progress * 100);
                statusMsg.textContent = `Downloading/Loading: ${percent}% (Caches after first load)`;
            }
        });
        
        statusMsg.textContent = "AI Ready. 100% Private & Local.";
        cancelLoadBtn.style.display = 'none';
        userInput.disabled = false; sendBtn.disabled = false;
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

cancelLoadBtn.onclick = () => {
    cancelLoadingFlag = true; // Interrupts the callback loop
    if (engine) engine.unload();
};

modelSelect.addEventListener('change', (e) => {
    if (e.target.value === "explore_all") {
        switchView('explore');
        renderExplorer();
        e.target.value = currentModel; // Revert select visually
    } else {
        switchView('chat');
        initAI(e.target.value);
    }
});

// --- Explorer Logic ---

function renderExplorer(filterText = "") {
    const recentGrid = document.getElementById('recent-models-grid');
    const allGrid = document.getElementById('all-models-grid');
    const recentSection = document.getElementById('recent-models-section');
    recentGrid.innerHTML = ''; allGrid.innerHTML = '';
    
    if (recentModels.length > 0 && !filterText) {
        recentSection.style.display = 'block';
        recentModels.forEach(id => {
            const m = MODEL_CATALOG.find(m => m.id === id);
            if(m) recentGrid.appendChild(createModelCard(m));
        });
    } else {
        recentSection.style.display = 'none';
    }

    MODEL_CATALOG.filter(m => m.name.toLowerCase().includes(filterText.toLowerCase()) || m.desc.toLowerCase().includes(filterText.toLowerCase()))
        .forEach(m => allGrid.appendChild(createModelCard(m)));
}

function createModelCard(model) {
    const card = document.createElement('div');
    card.className = 'model-card';
    card.innerHTML = `<h4>${model.name}</h4><p>${model.desc}</p>`;
    card.onclick = () => {
        switchView('chat');
        initAI(model.id);
    };
    return card;
}
document.getElementById('model-search').addEventListener('input', (e) => renderExplorer(e.target.value));

// --- Chat Logic ---

function appendMessageToUI(role, text, msgId = null, metricsHtml = "") {
    const container = document.createElement('div');
    container.className = `message-container ${role === 'user' ? 'user' : 'ai'}`;
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role === 'user' ? 'user-msg' : 'ai-msg'}`;
    msgDiv.textContent = text;
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
        chats[currentChatId] = currentMessages;
        localStorage.setItem('local_ai_chats', JSON.stringify(chats));
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
        titleSpan.textContent = chats[id][0]?.content || 'New Chat';
        
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
    currentMessages.forEach(msg => appendMessageToUI(msg.role, msg.content));
    renderHistorySidebar();
}

newChatBtn.onclick = () => {
    switchView('chat');
    currentChatId = Date.now().toString(); currentMessages = []; loadChat(currentChatId);
};

sendBtn.onclick = async () => {
    const text = userInput.value.trim();
    if (!text || !engine) return;
    
    userInput.value = ''; userInput.disabled = true; sendBtn.disabled = true;
    currentMessages.push({ role: "user", content: text });
    appendMessageToUI("user", text); saveChatToLocal();
    
    const replyId = "reply-" + Date.now();
    appendMessageToUI("assistant", "...", replyId, `<span id="metric-${replyId}">Generating...</span>`);
    const replyDiv = document.getElementById(replyId);
    const metricSpan = document.getElementById(`metric-${replyId}`);
    
    const startTime = performance.now();
    try {
        const memCtx = savedProfile.trim() ? `User info: ${savedProfile}. ` : "";
        const sysInstruction = `${savedSysPrompt}\n\n${memCtx}\nRULE: If user tells you a new fact about themselves, append: [MEMORY: fact here].`;
        
        const stream = await engine.chat.completions.create({
            messages: [{ role: "system", content: sysInstruction }, ...currentMessages.slice(-10)],
            stream: true,
        });
        
        let replyText = "";
        for await (const chunk of stream) {
            replyText += chunk.choices[0]?.delta.content || "";
            replyDiv.textContent = replyText;
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
        
        const timeSec = (performance.now() - startTime) / 1000;
        const estTokens = Math.max(1, Math.round(replyText.length / 4));
        metricSpan.textContent = `${estTokens} tokens • ${timeSec.toFixed(1)}s • ${(estTokens/timeSec).toFixed(1)} tok/s`;
        
        const memMatch = /\[MEMORY:\s*(.*?)\]/g;
        let match;
        while ((match = memMatch.exec(replyText)) !== null) {
            const newFact = match[1].trim();
            if (!savedProfile.includes(newFact)) {
                savedProfile += (savedProfile.length > 0 ? "\n" : "") + `- ${newFact}`;
                document.getElementById('profile-textarea').value = savedProfile;
                localStorage.setItem('local_ai_profile_text', savedProfile);
            }
        }
        
        const cleanReply = replyText.replace(/\[MEMORY:\s*(.*?)\]/g, '').trim();
        replyDiv.textContent = cleanReply;
        currentMessages.push({ role: "assistant", content: cleanReply });
        saveChatToLocal();
    } catch (e) {
        replyDiv.textContent = "Generation failed."; metricSpan.textContent = "Failed";
    }
    
    userInput.disabled = false; sendBtn.disabled = false; userInput.focus();
};
userInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendBtn.click(); });

// --- Boot ---
updateModelSelectDropdown();
initAI(currentModel);
