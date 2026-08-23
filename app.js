import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm";

const chatMessages = document.getElementById('chat-messages');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const newChatBtn = document.getElementById('new-chat-btn');
const historyList = document.getElementById('history-list');
const statusMsg = document.getElementById('status-msg');

let engine;
let currentChatId = Date.now().toString();
// Load history from the browser's local storage
let chats = JSON.parse(localStorage.getItem('local_ai_chats')) || {};
let currentMessages = chats[currentChatId] || [];

async function initAI() {
    try {
        // Downloads the model on first visit (~900MB), caches it for instant loading later
        engine = await CreateMLCEngine("Llama-3.2-1B-Instruct-q4f16_1-MLC", {
            initProgressCallback: (progress) => {
                const percent = Math.round(progress.progress * 100);
                statusMsg.textContent = `Downloading/Loading Model: ${percent}% (This takes a moment on your first visit)`;
            }
        });
        
        statusMsg.textContent = "AI Ready. 100% Private & Local.";
        userInput.disabled = false;
        sendBtn.disabled = false;
        
        renderHistorySidebar();
        loadChat(currentChatId);
    } catch (error) {
        statusMsg.textContent = `Hardware Error: Your browser may not support WebGPU. (${error.message})`;
        statusMsg.style.color = "#ff8a8a";
    }
}

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

function renderHistorySidebar() {
    historyList.innerHTML = '';
    // Show newest chats at the top
    Object.keys(chats).reverse().forEach(id => {
        const btn = document.createElement('div');
        btn.className = 'history-item';
        // Use the first user message as the title
        btn.textContent = chats[id][0]?.content || 'New Chat';
        btn.onclick = () => loadChat(id);
        historyList.appendChild(btn);
    });
}

function loadChat(id) {
    currentChatId = id;
    currentMessages = chats[id] || [];
    
    // Clear chat window but keep the system status message
    const sysMsg = document.getElementById('status-msg');
    chatMessages.innerHTML = '';
    if (sysMsg) chatMessages.appendChild(sysMsg);
    
    // Render past messages
    currentMessages.forEach(msg => appendMessageToUI(msg.role, msg.content));
}

newChatBtn.onclick = () => {
    currentChatId = Date.now().toString();
    currentMessages = [];
    loadChat(currentChatId);
};

sendBtn.onclick = async () => {
    const text = userInput.value.trim();
    if (!text || !engine) return;
    
    // Lock inputs
    userInput.value = '';
    userInput.disabled = true;
    sendBtn.disabled = true;
    
    // Add user message to UI and history
    currentMessages.push({ role: "user", content: text });
    appendMessageToUI("user", text);
    saveChatToLocal();
    
    // Create a placeholder for the AI's streaming response
    const replyId = "reply-" + Date.now();
    appendMessageToUI("assistant", "...", replyId);
    const replyDiv = document.getElementById(replyId);
    
    try {
        // Ask the AI and tell it to stream words as they are generated
        const stream = await engine.chat.completions.create({
            messages: currentMessages,
            stream: true,
        });
        
        let replyText = "";
        for await (const chunk of stream) {
            replyText += chunk.choices[0]?.delta.content || "";
            replyDiv.textContent = replyText;
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
        
        // Save the final AI response to history
        currentMessages.push({ role: "assistant", content: replyText });
        saveChatToLocal();
    } catch (e) {
        replyDiv.textContent = "Error generating response. Please refresh.";
    }
    
    // Unlock inputs
    userInput.disabled = false;
    sendBtn.disabled = false;
    userInput.focus();
};

// Allow pressing Enter to send
userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendBtn.click();
});

// Start the engine
initAI();
