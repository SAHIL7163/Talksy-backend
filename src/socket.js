import Message from './models/Message.js';
import User from './models/User.js';
import axios from 'axios';
import mongoose from 'mongoose';
import { publisher, subscriber } from './pubsub.js';

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
        let message = await Message.create({
          channelId,
          sender: senderId,
          text,
          parentMessage: parentMessage || null,
        });
        message = await message.populate("sender");

        if (parentMessage) {
          message = await message.populate({
            path: "parentMessage",
            populate: { path: "sender", select: "fullName profilePic" },
          });
        }

        message = message.toObject();

        await publisher.publish(
          `chat:${channelId}`,
          JSON.stringify({ type: "receive_message", payload: message })
        );
      } catch (error) {
        io.emit("error_message", { message: "Failed to send message" });
      }
    });

    // Mark message as read
    socket.on("message_read", async ({ messageId, channelId }) => {
      await publisher.publish(
        `chat:${channelId}`,
        JSON.stringify({ type: "message_read", payload: { messageId } })
      );
    });

    // Typing Indicators
    socket.on("typing", ({ channelId, userId }) =>
      publisher.publish(
        `chat:${channelId}`,
        JSON.stringify({ type: "typing", payload: { userId } })
      )
    );

    socket.on("stop_typing", ({ channelId, userId }) =>
      publisher.publish(
        `chat:${channelId}`,
        JSON.stringify({ type: "stop_typing", payload: { userId } })
      )
    );

    // Video Call Events
    socket.on("start_video_call", ({ channelId }) =>
      publisher.publish(
        `chat:${channelId}`,
        JSON.stringify({ type: "start_video_call", payload: { channelId } })
      )
    );

    socket.on("end_video_call", ({ channelId }) =>
      publisher.publish(
        `chat:${channelId}`,
        JSON.stringify({ type: "end_video_call", payload: { channelId } })
      )
    );

    // AI Message
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

        const history = recentMessages.reverse().map((msg) => ({
          role: msg.sender.toString() === aiUserId.toString() ? "model" : "user",
          parts: [{ text: msg.text || "[Empty message]" }],
        }));

        const messagesForGemini = [
          ...history,
          { role: "user", parts: [{ text }] },
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

        await publisher.publish(
          `chat:${channelId}`,
          JSON.stringify({ type: "receive_ai_message", payload: aiMessage })
        );
      } catch (error) {
        console.error("Error details:", error.response?.data || error.message);

        let errorMessage = "Failed to send AI message";
        if (error.response?.status === 400)
          errorMessage = "Invalid request to AI model. Check message structure.";
        else if (
          error.response?.status === 401 ||
          error.response?.status === 403
        )
          errorMessage = "Authentication error. Check your API key.";
        else if (error.response?.status === 404)
          errorMessage = "AI model not found.";
        else if (error.response?.status === 429)
          errorMessage = "Rate limit exceeded. Wait and try again.";
        else if (error.response?.status >= 500)
          errorMessage = "AI server error. Try again later.";

        await publisher.publish(
          `chat:${channelId}`,
          JSON.stringify({ type: "error_message", payload: errorMessage })
        );
      }
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });

  // Subscriber: listen to all chat channels
  subscriber.pSubscribe("chat:*", (message, channel) => {
    try {
      const channelId = channel.split(":")[1]; // e.g. roomId OR "global"
      const event = JSON.parse(message);

      if (channelId === "global") {
        // Broadcast to all connected sockets
        io.emit(event.type, event.payload);
      } else {
        // Broadcast only to the specific room
        io.to(channelId).emit(event.type, event.payload);
      }
    } catch (err) {
      console.error("Invalid message from Redis:", message, err);
    }
  });

}
