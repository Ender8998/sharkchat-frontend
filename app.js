// ---------------------------
//  SHARKCHAT SIGNALING
// ---------------------------
const ws = new WebSocket("wss://organic-waffle-p64g9xq965qfrrw4-3000.app.github.dev/");
let currentRoom = null;
let localStream;
let peer;

// UI elements
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const joinCode = document.getElementById("joinCode");
const roomDiv = document.getElementById("room");
const roomCodeDisplay = document.getElementById("roomCodeDisplay");
const startCallBtn = document.getElementById("startCallBtn");
const leaveBtn = document.getElementById("leaveBtn");

ws.onopen = () => {
    console.log("Connected to SharkChat signaling server");
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.action === "created") {
        currentRoom = data.code;
        roomCodeDisplay.innerText = "Room Code: " + currentRoom;
        roomDiv.style.display = "block";
    }

    if (data.action === "joined") {
        currentRoom = data.code;
        roomCodeDisplay.innerText = "Room Code: " + currentRoom;
        roomDiv.style.display = "block";
    }

    if (data.action === "signal") {
        handleSignal(data.payload);
    }
};

function createRoom() {
    ws.send(JSON.stringify({ action: "create" }));
}

function joinRoom() {
    ws.send(JSON.stringify({ action: "join", code: joinCode.value }));
}

function sendSignal(payload) {
    ws.send(JSON.stringify({
        action: "signal",
        code: currentRoom,
        payload
    }));
}

// ---------------------------
//  WEBRTC VOICE CALL
// ---------------------------
async function startCall() {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    peer = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    localStream.getTracks().forEach(track => {
        peer.addTrack(track, localStream);
    });

    peer.onicecandidate = (event) => {
        if (event.candidate) {
            sendSignal({ type: "ice", candidate: event.candidate });
        }
    };

    peer.ontrack = (event) => {
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.play();
    };

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    sendSignal({ type: "offer", sdp: offer });
}

async function handleSignal(payload) {
    if (payload.type === "offer") {
        peer = new RTCPeerConnection({
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
        });

        peer.onicecandidate = (event) => {
            if (event.candidate) {
                sendSignal({ type: "ice", candidate: event.candidate });
            }
        };

        peer.ontrack = (event) => {
            const audio = new Audio();
            audio.srcObject = event.streams[0];
            audio.play();
        };

        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStream.getTracks().forEach(track => {
            peer.addTrack(track, localStream);
        });

        await peer.setRemoteDescription(payload.sdp);

        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);

        sendSignal({ type: "answer", sdp: answer });
    }

    if (payload.type === "answer") {
        await peer.setRemoteDescription(payload.sdp);
    }

    if (payload.type === "ice") {
        try {
            await peer.addIceCandidate(payload.candidate);
        } catch (e) {
            console.error("ICE error:", e);
        }
    }
}

// ---------------------------
//  BUTTON EVENTS
// ---------------------------
createBtn.onclick = createRoom;
joinBtn.onclick = joinRoom;
startCallBtn.onclick = startCall;
leaveBtn.onclick = () => location.reload();
