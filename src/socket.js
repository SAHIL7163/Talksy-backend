import Message from './models/Message.js';
import User from './models/User.js';
import axios from 'axios';
import mongoose from 'mongoose';


export default function socketHandler(io) {
  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("register", ({ userId }) => {
      if (!userId) return;
      socket.join(userId.toString());
      console.log(`User ${userId} joined their personal room`);
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

    socket.on("start_video_call", ({ channelId }) => {
      socket.to(channelId).emit("start_video_call", { channelId });
    });
    socket.on("end_video_call", ({ channelId }) => {
      socket.to(channelId).emit("end_video_call", { channelId });
    });


    socket.on("send_ai_message", async ({ channelId, senderId, text }) => {
      try {
        if (!text || !text.trim()) text = "[Empty message]";

        await Message.create({
          channelId,
          sender: senderId,
          text,
          isRead: true,
        });

        const recentMessages = await Message.find({ channelId })
          .sort({ createdAt: -1 })
          .limit(5)
          .select("text sender");

        let aiUser = await User.findOne({ email: "ai@example.com" });
        if (!aiUser) {
          aiUser = await User.create({
            fullName: "AI",
            email: "ai@example.com",
            password: new mongoose.Types.ObjectId().toString(), // temporary password
          });
        }

        const aiUserId = aiUser._id;

        const history = recentMessages.reverse().map(msg => ({
          role: msg.sender.toString() === aiUserId.toString() ? "model" : "user",
          parts: [{ text: msg.text || "[Empty message]" }],
        }));

        const messagesForGemini = [
          ...history,
          { role: "user", parts: [{ text }] }
        ];

        const response = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${process.env.GEMINI_API_KEY}`,
          { contents: messagesForGemini },
          { headers: { "Content-Type": "application/json" } }
        );

        const aiResponse =
          response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
          "Sorry, I couldn't process that.";

        const aiMessage = await Message.create({
          channelId,
          sender: aiUserId,
          text: aiResponse,
        });

        io.to(channelId).emit("receive_ai_message", aiMessage);

      } catch (error) {
        console.error("Error details:", error.response?.data || error.message);

        let errorMessage = "Failed to send AI message";
        if (error.response?.status === 400) errorMessage = "Invalid request to AI model. Check message structure.";
        else if (error.response?.status === 401 || error.response?.status === 403) errorMessage = "Authentication error. Check your API key.";
        else if (error.response?.status === 404) errorMessage = "AI model not found.";
        else if (error.response?.status === 429) errorMessage = "Rate limit exceeded. Wait and try again.";
        else if (error.response?.status >= 500) errorMessage = "AI server error. Try again later.";

        io.to(channelId).emit("error_message", { message: errorMessage });
      }
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });

}