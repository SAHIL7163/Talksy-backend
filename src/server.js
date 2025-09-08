import express from 'express';
import "dotenv/config"
import cookieParser from 'cookie-parser';
import cors from 'cors';

import authRoutes from './routers/auth.route.js';
import userRoutes from './routers/user.route.js';
import chatRoutes from './routers/chat.route.js';
import { connectDB } from './lib/db.js';

import { createServer } from "http";
import { Server } from "socket.io";
import socketHandler from './socket.js';


const app = express();
const PORT = process.env.PORT;

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL,
    credentials: true,
  },
});

app.use(cors({
  origin: process.env.CLIENT_URL,
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chat', chatRoutes)

app.set('io', io);
socketHandler(io);

httpServer.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  connectDB();
});
