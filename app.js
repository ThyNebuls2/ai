import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm";

// DOM Elements
const chatMessages = document.getElementById('chat-messages');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const newChatBtn = document.getElementById('new-chat-btn');
const historyList = document.getElementById('history-list');
const statusMsg = document.getElementById('status-msg');
const modelSelect = document.getElementById('model-select');
const profileBtn = document.getElementById('profile-btn');
const profileModal = document.getElementById('profile-modal');

// State
let engine;
let currentChatId = Date.now().toString();
let chats = JSON.parse(localStorage.getItem('local_ai_chats')) || {};
let currentMessages = chats[currentChatId] || [];
let userProfile = JSON.parse(localStorage.getItem('local_ai_profile')) || [];

// Load saved model preference
const savedModel = localStorage.getItem('local_ai_model') || "Llama-3.2-1B-Instruct-q4f16_1-MLC";
modelSelect.value = savedModel;

// The core instruction that tells the AI to extract memory
function getSystemPrompt() {
    const memoryString = userProfile.length > 0 ? userProfile.join("; ") : "Nothing yet.";
    return {
        role: "system",
        content: `You are a helpful, private AI assistant running locally. 
        Here is what you currently know about the user: ${memoryString}. 
        IMPORTANT RULE: If the user tells you a new, significant fact about themselves (e.g., their job, hobbies, name, or preferences), you must append exactly this format at the very end of your response: [MEMORY: fact here]. Otherwise, respond normally.`
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
        // Engine handles unloading automatically when we create a new one
        await initAI(newModel); 
    }
});

function appendMessageToUI(role, text, id = null) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role === 'user' ? 'user-msg' : 'ai-msg'}`;
    msgDiv.textContent = text;
    if (id) msgDiv.id = id;
    
    chatMessages.appendChild(msgDiv);
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
    event.stopPropagation(); // Prevents loading the chat when clicking delete
    delete chats[id];
    localStorage.setItem('local_ai_chats', JSON.stringify(chats));
    if (currentChatId === id) {
        newChatBtn.click();
    } else {
        renderHistorySidebar();
    }
}

function renderHistorySidebar() {
    historyList.innerHTML = '';
    Object.keys(chats).reverse().forEach(id => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.onclick = () => loadChat(id);
        
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
    
    currentMessages.forEach(msg => appendMessageToUI(msg.role, msg.content));
}

newChatBtn.onclick = () => {
    currentChatId = Date.now().toString();
    currentMessages = [];
    loadChat(currentChatId);
};

// Profile Modal Logic
profileBtn.onclick = () => {
    const list = document.getElementById('memory-list');
    list.innerHTML = '';
    if (userProfile.length === 0) {
        list.innerHTML = '<li>Nothing recorded yet. Tell the AI about yourself!</li>';
    } else {
        userProfile.forEach(fact => {
            const li = document.createElement('li');
            li.textContent = fact;
            list.appendChild(li);
        });
    }
    profileModal.style.display = 'flex';
};
document.getElementById('close-modal-btn').onclick = () => profileModal.style.display = 'none';
window.onclick = (e) => { if (e.target === profileModal) profileModal.style.display = 'none'; };

sendBtn.onclick = async () => {
    const text = userInput.value.trim();
    if (!text || !engine) return;
    
    userInput.value = '';
    userInput.disabled = true; sendBtn.disabled = true;
    
    currentMessages.push({ role: "user", content: text });
    appendMessageToUI("user", text);
    saveChatToLocal();
    
    const replyId = "reply-" + Date.now();
    appendMessageToUI("assistant", "...", replyId);
    const replyDiv = document.getElementById(replyId);
    
    try {
        // Send System Prompt + ONLY the last 10 messages so the browser doesn't run out of RAM
        const messagesToPass = [
            getSystemPrompt(),
            ...currentMessages.slice(-10) 
        ];

        const stream = await engine.chat.completions.create({
            messages: messagesToPass,
            stream: true,
        });
        
        let replyText = "";
        for await (const chunk of stream) {
            replyText += chunk.choices[0]?.delta.content || "";
            // Temporarily show everything, including the memory tag if it's generating it
            replyDiv.textContent = replyText;
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
        
        // INTERCEPT MEMORY TAGS
        const memoryRegex = /\[MEMORY:\s*(.*?)\]/g;
        let match;
        while ((match = memoryRegex.exec(replyText)) !== null) {
            const newFact = match[1].trim();
            if (!userProfile.includes(newFact)) {
                userProfile.push(newFact);
                localStorage.setItem('local_ai_profile', JSON.stringify(userProfile));
            }
        }
        
        // Remove the memory tags from the final text so the user doesn't see them
        const cleanReplyText = replyText.replace(/\[MEMORY:\s*(.*?)\]/g, '').trim();
        replyDiv.textContent = cleanReplyText;

        currentMessages.push({ role: "assistant", content: cleanReplyText });
        saveChatToLocal();
    } catch (e) {
        replyDiv.textContent = "Error generating response. Try clearing chat or refreshing.";
    }
    
    userInput.disabled = false; sendBtn.disabled = false;
    userInput.focus();
};

userInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendBtn.click(); });

// Boot up
initAI(savedModel);
