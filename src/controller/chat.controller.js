import Message from '../models/Message.js';
import cloudinary from '../lib/cloudinary.js';
import { publisher } from '../lib/pubsub.js';

async function getChatMessages(req, res) {
  try {
    const { channelId } = req.params;
    const messages = await Message.find({ channelId })
      .populate('sender', 'fullName profilePic')
      .populate({
        path: 'parentMessage',
        populate: { path: 'sender', select: 'fullName profilePic' }
      });

    res.status(200).json(messages);
  } catch (error) {
    console.error("Error fetching chat messages:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
}

async function deleteMessage(req, res) {
  try {
    const { messageId } = req.params;
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    await Message.deleteOne({ _id: messageId });

    // Publish delete event
    await publisher.publish(
      `chat:${message.channelId}`,
      JSON.stringify({ type: "message_deleted", payload: { messageId } })
    );

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error deleting chat message:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
}

async function editMessage(req, res) {
  try {
    const { messageId } = req.params;
    const { text } = req.body;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    let updatedMessage = await Message.findByIdAndUpdate(
      messageId,
      { text, isEdited: true },
      { new: true }
    ).populate('sender', 'fullName profilePic');

    updatedMessage = await updatedMessage.populate({
      path: "parentMessage",
      populate: { path: "sender", select: "fullName profilePic" }
    });

    updatedMessage = updatedMessage.toObject();

    if (!updatedMessage) {
      return res.status(404).json({ message: "Message not found" });
    }

    // Publish edit event
    await publisher.publish(
      `chat:${message.channelId}`,
      JSON.stringify({ type: "message_edited", payload: updatedMessage })
    );

    res.status(200).json(updatedMessage);
  } catch (error) {
    console.error("Error updating message:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
}

async function MessageRead(req, res) {
  try {
    const { messageId } = req.params;

    if(!messageId) return res.status(400).json({ error: 'Missing messageId' });

    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ error: 'Message not found' });

    message.isRead = true;
    await message.save();

    // Publish read event
    await publisher.publish(
      `chat:${message.channelId}`,
      JSON.stringify({ type: "message_read", payload: { messageId } })
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function uploadFile(req, res) {
  try {
    const { channelId, senderId } = req.body;

    if (!channelId || !senderId) {
      return res.status(400).json({ error: 'Missing channelId or senderId' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'application/pdf',
    ];
    if (!allowedMimeTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'Unsupported file type. Only images and PDFs are allowed.' });
    }

    const timestamp = Math.round(Date.now() / 1000).toString();
    const signature = cloudinary.utils.api_sign_request(
      { timestamp },
      process.env.CLOUDINARY_API_SECRET
    );

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'auto',
          timestamp,
          api_key: process.env.CLOUDINARY_API_KEY,
          signature,
        },
        (error, result) => {
          if (error) return reject(error);
          if (!result?.secure_url) return reject(new Error('Upload failed: No secure URL returned'));
          resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    let fileType;
    if (result.resource_type === 'image') {
      fileType = `image/${result.format}`;
    } else if (result.resource_type === 'raw' && result.format === 'pdf') {
      fileType = 'application/pdf';
    } else {
      fileType = req.file.mimetype;
    }

    const message = new Message({
      channelId,
      sender: senderId,
      file: {
        url: result.secure_url,
        type: fileType,
        name: req.file.originalname,
      },
    });

    await message.save();
    const populatedMessage = await Message.findById(message._id).populate('sender');

    // Publish file message
    await publisher.publish(
      `chat:${channelId}`,
      JSON.stringify({ type: "receive_message", payload: populatedMessage })
    );

    res.json(populatedMessage);
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
}

export { getChatMessages, deleteMessage, editMessage, MessageRead, uploadFile };
