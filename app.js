// app.js - SharkChat (JSONP signaling ready)
// Replace GAS_URL with your Apps Script exec URL (the /exec URL).
// Leave WORKER_WSS_URL for later Cloudflare WSS (optional).
const GAS_URL = 'https://script.google.com/macros/s/AKfycbzdKisI8OYiV1nyu4UYI32XO3UP4SYxXjAgVCYXhJuUw_YpoLslDQHM48j7UABNkflt/exec';
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
    ws.onerror = (err) => {
      usingWSS = false;
      log('WSS error, using polling: ' + err);
    };
  } catch (err) {
    usingWSS = false;
    log('WSS connect failed: ' + err);
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
  // wait for offer via signaling; handleSignal will create answer
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
  pc.onconnectionstatechange = () => {
    log('PC state: ' + pc.connectionState);
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
    try { await pc.addIceCandidate(msg.candidate); } catch (e) { log('ICE add error: ' + e); }
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
  // fallback to GAS JSONP post
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

/* ---------------------------
   JSONP helper and postGAS
   --------------------------- */

// JSONP helper: call GAS via GET with callback
function jsonpGet(url, params = {}, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const callbackName = 'cb_' + Math.random().toString(36).slice(2,9);
    params.callback = callbackName;

    // Build query string safely
    const query = Object.keys(params).map(k => {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');

    const src = url + (url.includes('?') ? '&' : '?') + query;

    const script = document.createElement('script');
    script.src = src;
    script.async = true;

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('JSONP timeout'));
    }, timeout);

    window[callbackName] = (data) => {
      clearTimeout(timer);
      cleanup();
      resolve(data);
    };

    function cleanup() {
      try { delete window[callbackName]; } catch (e) {}
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    script.onerror = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error('JSONP load error'));
    };

    document.head.appendChild(script);
  });
}

// postGAS uses JSONP GET for create/post/poll actions
async function postGAS(body) {
  try {
    // For safety, stringify message param if present
    const params = {};
    for (const k in body) {
      if (body[k] === undefined || body[k] === null) continue;
      // If message is an object, stringify it
      if (k === 'message' && typeof body[k] === 'object') {
        params[k] = JSON.stringify(body[k]);
      } else {
        params[k] = String(body[k]);
      }
    }
    const res = await jsonpGet(GAS_URL, params);
    return res;
  } catch (e) {
    log('GAS JSONP error: ' + e);
    return null;
  }
}

/* ---------------------------
   Utilities
   --------------------------- */
function el(id) { return document.getElementById(id); }
function status(s) { statusEl.textContent = s; }
function log(s) { const d = document.createElement('div'); d.textContent = s; logEl.appendChild(d); }
