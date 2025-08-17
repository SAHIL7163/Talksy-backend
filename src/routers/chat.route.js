import express from 'express';
import "dotenv/config";
import { protectRoute } from '../middleware/auth.middleware.js';
import {  getChatMessages,deleteMessage ,editMessage,MessageRead, uploadFile} from '../controller/chat.controller.js';
import multer from 'multer';
 

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() }); // Store in memory for Cloudinary upload

router.get('/messages/:channelId', protectRoute, getChatMessages);
router.route('/message/:messageId')
  .delete(protectRoute, deleteMessage)
  .put(protectRoute, editMessage)

router.post('/message/file', protectRoute, upload.single('file'), uploadFile)
router.put('/message/:messageId/read', protectRoute, MessageRead);


export default router;