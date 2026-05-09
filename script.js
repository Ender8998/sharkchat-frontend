const peer = new Peer({
  host: "<your-codespace>-3000.app.github.dev",
  secure: true,
  port: 443,
  path: "/"
});

navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
  peer.on("call", call => {
    call.answer(stream);
    call.on("stream", remote => {
      new Audio(URL.createObjectURL(remote)).play();
    });
  });

  document.getElementById("call").onclick = () => {
    const id = prompt("Enter peer ID:");
    const call = peer.call(id, stream);
    call.on("stream", remote => {
      new Audio(URL.createObjectURL(remote)).play();
    });
  };
});
