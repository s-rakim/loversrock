import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import dotenv from "dotenv";

import { authRouter } from "./routes/auth.js";
import { dailyPromptRouter } from "./routes/dailyPrompt.js";
import { dailyQuizRouter } from "./routes/dailyQuiz.js";
import { memoriesRouter } from "./routes/memories.js";
import { bucketListRouter } from "./routes/bucketList.js";
import { dateIdeasRouter } from "./routes/dateIdeas.js";
import { countdownsRouter } from "./routes/countdowns.js";
import { messagesRouter } from "./routes/messages.js";
import { widgetPhotosRouter } from "./routes/widgetPhotos.js";

import { attachSockets } from "./sockets/index.js";
import { startCronJobs } from "./cron/index.js";
import { ensureBucketExists } from "./config/storage.js";
import { initFirebase } from "./config/firebase.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/daily-prompt", dailyPromptRouter);
app.use("/quiz", dailyQuizRouter);
app.use("/memories", memoriesRouter);
app.use("/bucket-list", bucketListRouter);
app.use("/date-ideas", dateIdeasRouter);
app.use("/countdowns", countdownsRouter);
app.use("/messages", messagesRouter);
app.use("/widget-photos", widgetPhotosRouter);

// Basic error handler so route stubs / unexpected errors don't crash the process.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const httpServer = createServer(app);
export const io = new Server(httpServer, { cors: { origin: "*" } });
attachSockets(io);

const PORT = process.env.PORT || 4000;

async function start() {
  initFirebase();
  await ensureBucketExists();
  startCronJobs();
  httpServer.listen(PORT, () => {
    console.log(`CandleApp backend listening on :${PORT}`);
  });
}

start();
