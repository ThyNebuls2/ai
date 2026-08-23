import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm";

// DOM Elements
const chatView = document.getElementById('chat-view');
const profileView = document.getElementById('profile-view');
const sysPromptView = document.getElementById('system-prompt-view');
const chatMessages = document.getElementById('chat-messages');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const newChatBtn = document.getElementById('new-chat-btn');
const historyList = document.getElementById('history-list');
const statusMsg = document.getElementById('status-msg');
const modelSelect = document.getElementById('model-select');
const profileBtn = document.getElementById('profile-btn');
const sysPromptBtn = document.getElementById('system-prompt-btn');

const profileTextarea = document.getElementById('profile-textarea');
const sysPromptTextarea = document.getElementById('system-prompt-textarea');

// State
let engine;
let currentChatId = Date.now().toString();
let chats = JSON.parse(localStorage.getItem('local_ai_chats')) || {};
let currentMessages = chats[currentChatId] || [];

// Load editable settings
let savedProfile = localStorage.getItem('local_ai_profile_text') || "";
let savedSysPrompt = localStorage.getItem('local_ai_sys_prompt_text') || "You are a helpful, private AI assistant.";
profileTextarea.value = savedProfile;
sysPromptTextarea.value = savedSysPrompt;

const savedModel = localStorage.getItem('local_ai_model') || "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
modelSelect.value = savedModel;

// Tab Switching Logic
function switchView(viewId) {
    chatView.classList.remove('active-view');
    profileView.classList.remove('active-view');
    sysPromptView.classList.remove('active-view');
    document.getElementById(viewId).classList.add('active-view');
}
profileBtn.onclick = () => switchView('profile-view');
sysPromptBtn.onclick = () => switchView('system-prompt-view');

// Auto-save settings when user types
profileTextarea.addEventListener('input', (e) => {
    savedProfile = e.target.value;
    localStorage.setItem('local_ai_profile_text', savedProfile);
});
sysPromptTextarea.addEventListener('input', (e) => {
    savedSysPrompt = e.target.value;
    localStorage.setItem('local_ai_sys_prompt_text', savedSysPrompt);
});

// Construct the master system instruction
function getSystemPrompt() {
    const memoryContext = savedProfile.trim() ? `Here is what you know about the user: ${savedProfile}. ` : "";
    const rules = `IMPORTANT RULE: If the user tells you a new fact about themselves, you must append exactly this format at the very end of your response: [MEMORY: fact here].`;
    
    return {
        role: "system",
        content: `${savedSysPrompt}\n\n${memoryContext}\n${rules}`
    };
}

async function initAI(modelId) {
    statusMsg.textContent = `Initializing Engine & Loading ${modelId}...`;
    statusMsg.style.color = "#a8c7fa";
    userInput.disabled = true; sendBtn.disabled = true;
    
    try {
        engine = await CreateMLCEngine(modelId, {
            initProgressCallback: (progress) => {
                const percent = Math.round(progress.progress * 100);
                statusMsg.textContent = `Loading Model: ${percent}% (Downloads only on first use)`;
            }
        });
        
        statusMsg.textContent = "AI Ready. 100% Private & Local.";
        userInput.disabled = false; sendBtn.disabled = false;
        renderHistorySidebar();
        loadChat(currentChatId);
    } catch (error) {
        statusMsg.textContent = `Hardware Error: ${error.message}`;
        statusMsg.style.color = "#ff8a8a";
    }
}

// Model Switching
modelSelect.addEventListener('change', async (e) => {
    const newModel = e.target.value;
    localStorage.setItem('local_ai_model', newModel);
    if (engine) {
        statusMsg.textContent = "Unloading current model...";
        await initAI(newModel); 
    }
});

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

function deleteChat(id, event) {
    event.stopPropagation(); 
    delete chats[id];
    localStorage.setItem('local_ai_chats', JSON.stringify(chats));
    if (currentChatId === id) newChatBtn.click();
    else renderHistorySidebar();
}

function renderHistorySidebar() {
    historyList.innerHTML = '';
    Object.keys(chats).reverse().forEach(id => {
        const item = document.createElement('div');
        item.className = `history-item ${id === currentChatId ? 'active' : ''}`;
        
        // Clicking a chat switches to Chat View and loads it
        item.onclick = () => {
            switchView('chat-view');
            loadChat(id);
        };
        
        const titleSpan = document.createElement('span');
        titleSpan.className = 'chat-title';
        titleSpan.textContent = chats[id][0]?.content || 'New Chat';
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '&times;';
        deleteBtn.onclick = (e) => deleteChat(id, e);
        
        item.appendChild(titleSpan);
        item.appendChild(deleteBtn);
        historyList.appendChild(item);
    });
}

function loadChat(id) {
    currentChatId = id;
    currentMessages = chats[id] || [];
    
    const sysMsg = document.getElementById('status-msg');
    chatMessages.innerHTML = '';
    if (sysMsg) chatMessages.appendChild(sysMsg);
    
    currentMessages.forEach(msg => {
        // We don't save the metrics string to memory to save space, so they only appear for new messages
        appendMessageToUI(msg.role, msg.content);
    });
    renderHistorySidebar(); // Update active highlight
}

newChatBtn.onclick = () => {
    switchView('chat-view');
    currentChatId = Date.now().toString();
    currentMessages = [];
    loadChat(currentChatId);
};

sendBtn.onclick = async () => {
    const text = userInput.value.trim();
    if (!text || !engine) return;
    
    userInput.value = '';
    userInput.disabled = true; sendBtn.disabled = true;
    
    currentMessages.push({ role: "user", content: text });
    appendMessageToUI("user", text);
    saveChatToLocal();
    
    const replyId = "reply-" + Date.now();
    // Create the container with the message and an empty metrics div below it
    appendMessageToUI("assistant", "...", replyId, `<span id="metric-${replyId}">Generating...</span>`);
    const replyDiv = document.getElementById(replyId);
    const metricSpan = document.getElementById(`metric-${replyId}`);
    
    const startTime = performance.now();
    
    try {
        const messagesToPass = [ getSystemPrompt(), ...currentMessages.slice(-10) ];
        const stream = await engine.chat.completions.create({ messages: messagesToPass, stream: true });
        
        let replyText = "";
        for await (const chunk of stream) {
            replyText += chunk.choices[0]?.delta.content || "";
            replyDiv.textContent = replyText;
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
        
        // Calculate Metrics
        const timeTakenSec = (performance.now() - startTime) / 1000;
        // Estimate token count (roughly 4 characters per token)
        const estTokens = Math.max(1, Math.round(replyText.length / 4));
        const tps = (estTokens / timeTakenSec).toFixed(1);
        metricSpan.textContent = `${estTokens} tokens • ${timeTakenSec.toFixed(1)}s • ${tps} tok/s`;
        
        // Auto-Memory Interception
        const memoryRegex = /\[MEMORY:\s*(.*?)\]/g;
        let match;
        let memoryAdded = false;
        while ((match = memoryRegex.exec(replyText)) !== null) {
            const newFact = match[1].trim();
            if (!savedProfile.includes(newFact)) {
                // Append it to the textarea
                savedProfile += (savedProfile.length > 0 ? "\n" : "") + `- ${newFact}`;
                profileTextarea.value = savedProfile;
                localStorage.setItem('local_ai_profile_text', savedProfile);
                memoryAdded = true;
            }
        }
        
        const cleanReplyText = replyText.replace(/\[MEMORY:\s*(.*?)\]/g, '').trim();
        replyDiv.textContent = cleanReplyText;

        currentMessages.push({ role: "assistant", content: cleanReplyText });
        saveChatToLocal();
    } catch (e) {
        replyDiv.textContent = "Error generating response. Try clearing chat or refreshing.";
        metricSpan.textContent = "Failed";
    }
    
    userInput.disabled = false; sendBtn.disabled = false;
    userInput.focus();
};

userInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendBtn.click(); });

initAI(savedModel);
