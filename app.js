// ---------------------------
//  CONFIG
// ---------------------------
const WS_URL = "wss://organic-waffle-p64g9xq965qfrrw4-3000.app.github.dev/";
const PING_URL = "https://organic-waffle-p64g9xq965qfrrw4-3000.app.github.dev/";

// ---------------------------
//  DOM
// ---------------------------
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const joinCodeInput = document.getElementById("joinCode");
const displayNameInput = document.getElementById("displayName");
const avatarColorInput = document.getElementById("avatarColor");

const roomDiv = document.getElementById("room");
const roomCodeDisplay = document.getElementById("roomCodeDisplay");
const memberList = document.getElementById("memberList");
const avatarPreview = document.getElementById("avatarPreview");
const startCallBtn = document.getElementById("startCallBtn");
const muteBtn = document.getElementById("muteBtn");
const pttBtn = document.getElementById("pttBtn");
const leaveBtn = document.getElementById("leaveBtn");
const logEl = document.getElementById("log");
const pingValueEl = document.getElementById("pingValue");
const pingIndicator = document.getElementById("pingIndicator");
const connectionStateEl = document.getElementById("connectionState");
const doomOverlay = document.getElementById("doomOverlay");
const doomMessage = document.getElementById("doomMessage");

// ---------------------------
//  STATE
// ---------------------------
let ws;
let currentRoom = null;
let localStream = null;
let peer = null;
let isMuted = false;
let pttEnabled = true;
let lastPing = 0;
let pingTimer = null;
let pingFailCount = 0;
let members = {}; // id -> {name,color}
let pendingPings = new Map(); // id -> timestamp

// thresholds
const PING_INTERVAL = 4000;
const WS_PONG_TIMEOUT = 2000;
const FAIL_THRESHOLD = 3;
const LATENCY_DOOM_MS = 3000;

// ---------------------------
//  UTIL
// ---------------------------
function log(msg){
  const time = new Date().toLocaleTimeString();
  logEl.innerHTML = `<div>[${time}] ${escapeHtml(msg)}</div>` + logEl.innerHTML;
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function updateAvatarPreview(){
  const name = (displayNameInput.value || "Ace").trim();
  avatarPreview.textContent = name.charAt(0).toUpperCase();
  avatarPreview.style.background = avatarColorInput.value;
}

function setConnectionState(text){
  connectionStateEl.textContent = text;
}

// ---------------------------
//  WEBSOCKET SIGNALING + PING
// ---------------------------
function connectWS(){
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    setConnectionState("Connected");
    log("Connected to signaling server");
    startPingLoop();
  };

  ws.onmessage = (ev) => {
    let data;
    try { data = JSON.parse(ev.data); } catch(e){ return; }

    // handle server pong for our ping
    if (data.action === "pong" && data.pingId){
      const sent = pendingPings.get(data.pingId);
      if (sent){
        const rtt = Math.round(performance.now() - sent);
        pendingPings.delete(data.pingId);
        lastPing = rtt;
        pingFailCount = 0;
        updatePingIndicator(rtt);
      }
      return;
    }

    if (data.action === "created"){
      currentRoom = data.code;
      roomCodeDisplay.textContent = "Room Code: " + currentRoom;
      roomDiv.classList.remove("hidden");
      log("Room created: " + currentRoom);
      addMember("you", displayNameInput.value || "Ace", avatarColorInput.value);
    }

    if (data.action === "joined"){
      currentRoom = data.code;
      roomCodeDisplay.textContent = "Room Code: " + currentRoom;
      roomDiv.classList.remove("hidden");
      log("Joined room: " + currentRoom);
      addMember("you", displayNameInput.value || "Ace", avatarColorInput.value);
    }

    if (data.action === "signal"){
      handleSignal(data.payload);
    }

    if (data.action === "error"){
      log("Server error: " + data.error);
    }
  };

  ws.onclose = () => {
    setConnectionState("Disconnected");
    log("Disconnected from signaling server");
    stopPingLoop();
    showDoomIfNeeded();
  };

  ws.onerror = (e) => {
    log("WebSocket error");
  };
}

function sendWS(obj){
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(obj));
}

// send a ping over WebSocket and expect server to reply with {action:"pong", pingId}
function wsPing(){
  if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject();
  const id = Math.random().toString(36).slice(2,10);
  pendingPings.set(id, performance.now());
  sendWS({ action: "ping", pingId: id });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pendingPings.has(id)) pendingPings.delete(id);
      reject(new Error("pong timeout"));
    }, WS_PONG_TIMEOUT);
    // resolution happens in onmessage when pong arrives
    const check = setInterval(() => {
      if (!pendingPings.has(id)){
        clearTimeout(timeout);
        clearInterval(check);
        resolve();
      }
    }, 50);
  });
}

// fallback HTTP ping
async function httpPing(){
  const start = performance.now();
  try {
    await fetch(PING_URL, {cache:"no-store", mode:"cors"});
    const elapsed = Math.round(performance.now() - start);
    lastPing = elapsed;
    pingFailCount = 0;
    updatePingIndicator(elapsed);
    return elapsed;
  } catch (e){
    pingFailCount++;
    updatePingIndicator(null);
    log("HTTP ping failed");
    return null;
  }
}

async function pingOnce(){
  // prefer WebSocket ping if available
  if (ws && ws.readyState === WebSocket.OPEN){
    try {
      await wsPing();
      // wsPing sets lastPing via pong handler
      return;
    } catch (e){
      // ws ping failed, try HTTP fallback
      await httpPing();
      return;
    }
  } else {
    await httpPing();
  }
}

function updatePingIndicator(ms){
  pingIndicator.classList.remove("good","warn","bad");
  if (ms === null || typeof ms === "undefined"){
    pingIndicator.classList.add("bad");
    pingIndicator.textContent = "Ping: — ms";
  } else if (ms < 150){
    pingIndicator.classList.add("good");
    pingIndicator.textContent = `Ping: ${ms} ms`;
  } else if (ms < 500){
    pingIndicator.classList.add("warn");
    pingIndicator.textContent = `Ping: ${ms} ms`;
  } else {
    pingIndicator.classList.add("bad");
    pingIndicator.textContent = `Ping: ${ms} ms`;
  }

  // doom condition
  if (pingFailCount >= FAIL_THRESHOLD || (ms !== null && ms > LATENCY_DOOM_MS)){
    showDoom();
  } else {
    hideDoom();
  }
}

function startPingLoop(){
  if (pingTimer) clearInterval(pingTimer);
  pingOnce();
  pingTimer = setInterval(pingOnce, PING_INTERVAL);
}

function stopPingLoop(){
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
}

function showDoom(){
  doomOverlay.classList.remove("hidden");
}

function hideDoom(){
  doomOverlay.classList.add("hidden");
}

function showDoomIfNeeded(){
  if (!ws || ws.readyState !== WebSocket.OPEN){
    showDoom();
  }
}

// ---------------------------
//  ROOM / MEMBERS UI
// ---------------------------
function addMember(id, name, color){
  members[id] = {name, color};
  renderMembers();
}

function removeMember(id){
  delete members[id];
  renderMembers();
}

function renderMembers(){
  memberList.innerHTML = "";
  Object.keys(members).forEach(id => {
    const m = members[id];
    const el = document.createElement("div");
    el.className = "member";
    el.innerHTML = `<div class="avatar" style="width:28px;height:28px;border-radius:6px;background:${m.color};font-size:12px;display:inline-flex;align-items:center;justify-content:center">${m.name.charAt(0).toUpperCase()}</div>
                    <div>${escapeHtml(m.name)}</div>`;
    memberList.appendChild(el);
  });
}

// ---------------------------
//  WEBRTC
// ---------------------------
async function startCall(){
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e){
    log("Microphone access denied");
    return;
  }

  peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

  // add local tracks
  localStream.getTracks().forEach(track => peer.addTrack(track, localStream));

  peer.onicecandidate = (ev) => {
    if (ev.candidate) sendSignal({ type: "ice", candidate: ev.candidate });
  };

  peer.ontrack = (ev) => {
    const audio = new Audio();
    audio.srcObject = ev.streams[0];
    audio.autoplay = true;
    audio.play().catch(()=>{});
  };

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  sendSignal({ type: "offer", sdp: offer, meta: { name: displayNameInput.value || "Ace", color: avatarColorInput.value } });

  log("Call started, offer sent");
}

async function handleSignal(payload){
  if (!payload) return;

  if (payload.type === "offer"){
    if (!localStream){
      try { localStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch(e){ log("Microphone access denied"); return; }
    }

    peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

    localStream.getTracks().forEach(track => peer.addTrack(track, localStream));

    peer.onicecandidate = (ev) => {
      if (ev.candidate) sendSignal({ type: "ice", candidate: ev.candidate });
    };

    peer.ontrack = (ev) => {
      const audio = new Audio();
      audio.srcObject = ev.streams[0];
      audio.autoplay = true;
      audio.play().catch(()=>{});
    };

    if (payload.meta && payload.meta.name){
      addMember(payload.meta.name + Math.random().toString(36).slice(2,5), payload.meta.name, payload.meta.color || "#888");
    }

    await peer.setRemoteDescription(payload.sdp);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    sendSignal({ type: "answer", sdp: answer });
    log("Received offer, sent answer");
  }

  if (payload.type === "answer"){
    if (peer) {
      await peer.setRemoteDescription(payload.sdp);
      log("Received answer");
    }
  }

  if (payload.type === "ice"){
    if (peer && payload.candidate){
      try { await peer.addIceCandidate(payload.candidate); }
      catch(e){ console.warn("ICE add failed", e); }
    }
  }
}

// ---------------------------
//  SIGNAL WRAPPERS
// ---------------------------
function createRoom(){
  updateAvatarPreview();
  sendWS({ action: "create" });
}

function joinRoom(){
  updateAvatarPreview();
  const code = joinCodeInput.value.trim().toUpperCase();
  if (!code) { log("Enter a room code"); return; }
  sendWS({ action: "join", code });
}

function sendSignal(payload){
  if (!currentRoom){
    log("No room selected");
    return;
  }
  sendWS({ action: "signal", code: currentRoom, payload });
}

// ---------------------------
//  PUSH TO TALK & MUTE
// ---------------------------
function setMute(on){
  isMuted = on;
  if (localStream){
    localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  }
  muteBtn.textContent = isMuted ? "Unmute" : "Mute";
  log(isMuted ? "Muted" : "Unmuted");
}

function handlePTT(pressed){
  if (!pttEnabled) return;
  setMute(!pressed);
}

// keyboard PTT (space)
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !e.repeat){
    handlePTT(true);
    pttBtn.classList.add("active");
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space"){
    handlePTT(false);
    pttBtn.classList.remove("active");
    e.preventDefault();
  }
});

// ---------------------------
//  UI EVENTS
// ---------------------------
createBtn.onclick = createRoom;
joinBtn.onclick = joinRoom;
startCallBtn.onclick = startCall;
muteBtn.onclick = () => setMute(!isMuted);
pttBtn.onclick = () => { pttEnabled = !pttEnabled; pttBtn.textContent = pttEnabled ? "Push to Talk (Hold Space)" : "Push to Talk Disabled"; };
leaveBtn.onclick = () => location.reload();

displayNameInput.addEventListener("input", updateAvatarPreview);
avatarColorInput.addEventListener("input", updateAvatarPreview);

// ---------------------------
//  STARTUP
// ---------------------------
updateAvatarPreview();
connectWS();
log("Client started");
hideDoom();
