const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" } // Allow all origins for dev
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // --- Join Room ---
  socket.on("joinRoom", (roomId) => {
    socket.join(roomId);
    console.log(`User ${socket.id} joined room ${roomId}`);

    const room = io.sockets.adapter.rooms.get(roomId);
    const usersInRoom = room ? Array.from(room).filter(id => id !== socket.id) : [];

    console.log(`Users in room ${roomId}:`, usersInRoom);
    
    // Send existing users to the new user
    socket.emit("allUsers", usersInRoom);
    
    // Notify existing users about the new user
    socket.to(roomId).emit("userConnected", socket.id);
  });

  // --- WebRTC signaling ---
  socket.on("sendingSignal", payload => {
    console.log(`Signal from ${payload.callerID} to ${payload.userToSignal}`);
    io.to(payload.userToSignal).emit("userJoined", {
      signal: payload.signal,
      callerID: payload.callerID
    });
  });

  socket.on("returningSignal", payload => {
    console.log(`Return signal from ${socket.id} to ${payload.callerID}`);
    io.to(payload.callerID).emit("receivingReturnedSignal", {
      signal: payload.signal,
      id: socket.id
    });
  });

  // --- Video sync events ---
  ["play", "pause", "seek"].forEach(event => {
    socket.on(event, (data) => {
      socket.to(data.roomId).emit(event, data);
    });
  });

  // --- Host sharing notification ---
  socket.on("hostStartedSharing", (roomId) => {
    console.log(`Host ${socket.id} started sharing in room ${roomId}`);
    socket.to(roomId).emit("hostStartedSharing");
  });

  // --- Guest requesting connection to host ---
  socket.on("requestHostConnection", (roomId) => {
    console.log(`Guest ${socket.id} requesting connection in room ${roomId}`);
    socket.to(roomId).emit("guestRequestingConnection", socket.id);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

server.listen(3001, () => console.log("Server running on port 3001"));