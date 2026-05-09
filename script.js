const peer = new Peer({
  host: "organic-waffle-p64g9xq965qfrrw4-3000.app.github.dev",
  secure: true,
  port: 443,
  path: "/"
});

peer.on("open", id => {
  console.log("My peer ID is:", id);
  document.body.insertAdjacentHTML("beforeend", `<p>Your ID: <b>${id}</b></p>`);
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
