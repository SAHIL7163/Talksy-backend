import Message from './models/Message.js';
const userSocketMap = new Map();

export function getUserSocket(userId) {
  return userSocketMap.get(userId);
}


export default function socketHandler(io) {
  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // Register user
    socket.on("register", ({ userId }) => {
      userSocketMap.set(userId, socket.id);
      console.log(`User ${userId} registered with socket ${socket.id}`);
    });

    // Join Chat Room
    socket.on("join_room", (channelId) => {
      socket.join(channelId);
      console.log(`Socket ${socket.id} joined room ${channelId}`);
    });

    // Send Message
    socket.on("send_message", async ({ channelId, senderId, text, parentMessage }) => {
      try {
        let message = await Message.create({ channelId, sender: senderId, text, parentMessage: parentMessage || null });
        message = await message.populate("sender")

        if (parentMessage) {
          message = await message.populate({
            path: "parentMessage",
            populate: { path: "sender", select: "fullName profilePic" }
          });
       }
       message = message.toObject();

        io.to(channelId).emit("receive_message", message);
      } catch (error) {
        io.emit("error_message", { message: "Failed to send message" });
      }
    });

    socket.on('message_read', ({ messageId, channelId }) => {
    io.to(channelId).emit('message_read', { messageId });
   });

    // Typing Indicators
    socket.on("typing", ({ channelId, userId }) => socket.to(channelId).emit("typing", userId));
    socket.on("stop_typing", ({ channelId, userId }) => socket.to(channelId).emit("stop_typing", userId));

    // In your socketHandler(io)
    socket.on("start_video_call", ({ channelId }) => {
        socket.to(channelId).emit("start_video_call", { channelId });
      });
    socket.on("end_video_call", ({ channelId }) => {
        socket.to(channelId).emit("end_video_call", { channelId });
      });

    socket.on("disconnect", () => {
      for (const [userId, id] of userSocketMap.entries()) {
        if (id === socket.id) {
          userSocketMap.delete(userId);
          break;
        }
      }
    });
  });
}