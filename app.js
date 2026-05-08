// app.js
// Replace GAS_URL with your Apps Script exec URL before publishing
// Leave WORKER_WSS_URL for later Cloudflare WSS (optional)
const GAS_URL = 'https://script.google.com/macros/s/REPLACE_WITH_YOUR_DEPLOY_ID/exec';
const WORKER_WSS_URL = 'wss://REPLACE_WITH_YOUR_WORKER_DOMAIN/ws';

const POLL_INTERVAL = 1500;

let localStream = null;
let pc = null;
let roomCode = null;
let pollSince = 0;
let pollTimer = null;
let isMuted = false;
let ws = null;
let usingWSS = false;

const statusEl = el('status');
const peersEl = el('peers');
const logEl = el('log');

el('createBtn').onclick = async () => {
  const res = await postGAS({ action: 'create' });
  if (res && res.ok) {
    roomCode = res.code;
    enterRoom();
    startAsCaller();
  } else status('Create failed');
};

el('joinBtn').onclick = async () => {
  const code = el('joinCode').value.trim().toUpperCase();
  if (!code) return status('Enter code');
  roomCode = code;
  enterRoom();
  startAsCallee();
};

el('leaveBtn').onclick = () => { cleanupAndLeave(); };

el('muteBtn').onclick = () => {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  el('muteBtn').textContent = isMuted ? 'Unmute' : 'Mute';
  sendSignal({ type: 'presence', muted: isMuted });
};

function enterRoom() {
  document.getElementById('lobby').hidden = true;
  document.getElementById('room').hidden = false;
  el('roomCode').textContent = roomCode;
  status('In room ' + roomCode);
  tryConnectWSS();
  startPolling();
}

async function tryConnectWSS() {
  if (!WORKER_WSS_URL || WORKER_WSS_URL.includes('REPLACE_WITH')) return;
  try {
    ws = new WebSocket(WORKER_WSS_URL + '?room=' + encodeURIComponent(roomCode));
    ws.onopen = () => {
      usingWSS = true;
      status('Connected to WSS signaling');
      log('WSS open');
    };
    ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data);
      await handleSignal(msg);
    };
    ws.onclose = () => {
      usingWSS = false;
      log('WSS closed, falling back to polling');
    };
    ws.onerror = () => {
      usingWSS = false;
      log('WSS error, using polling');
    };
  } catch (err) {
    usingWSS = false;
    log('WSS connect failed');
  }
}

async function startAsCaller() {
  await ensureLocalStream();
  pc = createPeerConnection();
  pc.addTrack(localStream.getAudioTracks()[0], localStream);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await sendSignal({ type: 'offer', sdp: offer.sdp });
}

async function startAsCallee() {
  await ensureLocalStream();
  pc = createPeerConnection();
  pc.addTrack(localStream.getAudioTracks()[0], localStream);
}

function createPeerConnection() {
  const cfg = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  const pc = new RTCPeerConnection(cfg);
  pc.ontrack = e => {
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.srcObject = e.streams[0];
    const li = document.createElement('li');
    li.textContent = 'Remote';
    li.appendChild(audio);
    peersEl.appendChild(li);
  };
  pc.onicecandidate = e => {
    if (e.candidate) sendSignal({ type: 'ice', candidate: e.candidate });
  };
  return pc;
}

async function handleSignal(msg) {
  if (!msg || !msg.type) return;
  if (msg.type === 'offer') {
    if (!pc) pc = createPeerConnection();
    await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await sendSignal({ type: 'answer', sdp: answer.sdp });
  } else if (msg.type === 'answer') {
    if (!pc) return;
    await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
  } else if (msg.type === 'ice') {
    try { await pc.addIceCandidate(msg.candidate); } catch (e) {}
  } else if (msg.type === 'presence') {
    status('Peer muted: ' + (msg.muted ? 'yes' : 'no'));
  }
}

async function ensureLocalStream() {
  if (localStream) return;
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
}

async function sendSignal(payload) {
  if (usingWSS && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
    return;
  }
  await postGAS({ action: 'post', code: roomCode, message: JSON.stringify(payload) });
}

function startPolling() {
  pollTimer = setInterval(async () => {
    if (usingWSS) return;
    const res = await postGAS({ action: 'poll', code: roomCode, since: pollSince });
    if (!res || !res.ok) return;
    for (const m of res.messages) {
      pollSince = Math.max(pollSince, m.id);
      const msg = JSON.parse(m.message);
      await handleSignal(msg);
    }
  }, POLL_INTERVAL);
}

function cleanupAndLeave() {
  clearInterval(pollTimer);
  if (pc) pc.close();
  if (ws) ws.close();
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  document.getElementById('lobby').hidden = false;
  document.getElementById('room').hidden = true;
  peersEl.innerHTML = '';
  status('Left');
}

async function postGAS(body) {
  try {
    const r = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' }
    });
    return await r.json();
  } catch (e) {
    log('GAS post error: ' + e);
    return null;
  }
}

function el(id) { return document.getElementById(id); }
function status(s) { statusEl.textContent = s; }
function log(s) { const d = document.createElement('div'); d.textContent = s; logEl.appendChild(d); }
