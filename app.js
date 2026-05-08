// SharkChat WebSocket Signaling
const ws = new WebSocket("wss://organic-waffle-p64g9xq965qfrrw4-3000.app.github.dev/");
let currentRoom = null;

ws.onopen = () => {
  console.log("Connected to SharkChat signaling server");
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.action === "created") {
    currentRoom = data.code;
    console.log("Room created:", currentRoom);
    showRoomUI();
  }

  if (data.action === "joined") {
    currentRoom = data.code;
    console.log("Joined room:", currentRoom);
    showRoomUI();
  }

  if (data.action === "signal") {
    handleSignal(data.payload);
  }

  if (data.action === "error") {
    alert(data.error);
  }
};

function createRoom() {
  ws.send(JSON.stringify({ action: "create" }));
}

function joinRoom(code) {
  ws.send(JSON.stringify({ action: "join", code }));
}

function sendSignal(payload) {
  ws.send(JSON.stringify({
    action: "signal",
    code: currentRoom,
    payload
  }));
}
