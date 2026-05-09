// ===============================
// SHARKCHAT PEERJS FRONTEND
// ===============================

// Create PeerJS connection
const peer = new Peer({
  host: "organic-waffle-p64g9xq965qfrrw4-3000.app.github.dev", // <-- CHANGE THIS ONLY
  secure: true,
  port: 443,
  path: "/"
});

// Show Peer ID when connected
peer.on("open", id => {
  console.log("Your Peer ID:", id);
  document.body.insertAdjacentHTML("beforeend", `
    <p style="font-size:20px;">Your ID: <b>${id}</b></p>
  `);
});

// Handle PeerJS errors
peer.on("error", err => {
  console.error("PeerJS Error:", err);
  document.body.insertAdjacentHTML("beforeend", `
    <p style="color:red;">PeerJS Error: ${err.type}</p>
  `);
});

// Get microphone
navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {

  // Incoming calls
  peer.on("call", call => {
    console.log("Incoming call from:", call.peer);
    call.answer(stream);

    call.on("stream", remote => {
      console.log("Received remote audio");
      const audio = new Audio();
      audio.srcObject = remote;
      audio.play();
    });
  });

  // Outgoing calls
  document.getElementById("call").onclick = () => {
    const id = prompt("Enter peer ID to call:");
    console.log("Calling:", id);

    const call = peer.call(id, stream);

    call.on("stream", remote => {
      console.log("Call connected");
      const audio = new Audio();
      audio.srcObject = remote;
      audio.play();
    });
  };

}).catch(err => {
  console.error("Microphone error:", err);
  document.body.insertAdjacentHTML("beforeend", `
    <p style="color:red;">Microphone access failed</p>
  `);
});
