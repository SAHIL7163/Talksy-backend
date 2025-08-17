import Message from '../models/Message.js';
import cloudinary from '../lib/cloudinary.js';

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

async function deleteMessage(req,res)
{
    try{
        const { messageId} = req.params;
        const message = await Message.findById(messageId);
        if (!message) {
            return res.status(404).json({ message: "Message not found" });
        }
        await Message.deleteOne({_id : messageId } );
        console.log("message is deleted")
        
        const io = req.app.get('io');
        if (io) {
            io.to(message.channelId.toString()).emit("message_deleted", { messageId });
        }

        res.status(200).json({ success: true });
    }catch(error)
    {
        console.error("Error fetching chat messages:", error);
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
            { text ,isEdited: true},
            { new: true }   
        ).populate('sender', 'fullName profilePic')

        updatedMessage = await updatedMessage.populate({
           "path": "parentMessage",
            "populate": { "path": "sender", "select": "fullName profilePic" }
        });
        updatedMessage = updatedMessage.toObject();
        
        if (!updatedMessage) {
            return res.status(404).json({ message: "Message not found" });
        }


        const io = req.app.get('io');
        if (io) {
            io.to(message.channelId.toString()).emit("message_edited", updatedMessage );
        }
        res.status(200).json(updatedMessage);
    } catch (error) {
        console.error("Error updating message:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
};

async function MessageRead(req, res) {
  try {
    const { messageId } = req.params;
    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ error: 'Message not found' });

    message.isRead = true;
    await message.save();

    const io = req.app.get('io');
    if (io) {
      io.to(message.channelId.toString()).emit('message_read', { messageId });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};


async function uploadFile(req, res) {
  try {
    const { channelId, senderId } = req.body;

    // Validate required fields
    if (!channelId || !senderId) {
      return res.status(400).json({ error: 'Missing channelId or senderId' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Validate file type (only allow images and PDFs)
    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'application/pdf',
    ];
    if (!allowedMimeTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'Unsupported file type. Only images and PDFs are allowed.' });
    }

    // Generate timestamp and signature for Cloudinary
    const timestamp = Math.round(Date.now() / 1000).toString();
    const signature = cloudinary.utils.api_sign_request(
      { timestamp },
      process.env.CLOUDINARY_API_SECRET
    );

    // Upload file to Cloudinary
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'auto', // Let Cloudinary determine the resource type
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

    // Determine the correct MIME type
    let fileType;
    if (result.resource_type === 'image') {
      fileType = `image/${result.format}`; // e.g., image/jpeg, image/png
    } else if (result.resource_type === 'raw' && result.format === 'pdf') {
      fileType = 'application/pdf'; // Explicitly set for PDFs
    } else {
      fileType = req.file.mimetype; // Fallback to client-provided MIME type
    }

    // Create and save message
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

    const io = req.app.get('io');
    if (io) {
      io.to(channelId).emit('receive_message', populatedMessage);
    }

    res.json(populatedMessage);
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
}

export { getChatMessages, deleteMessage, editMessage ,MessageRead, uploadFile };



