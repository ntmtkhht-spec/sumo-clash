import express from "express";
import cors from "cors";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { monitor } from "@colyseus/monitor";
import { createServer } from "http";
import { BattleRoom } from "./rooms/BattleRoom";

const port = process.env.PORT ? Number(process.env.PORT) : 2567;

const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({
    server
  })
});

gameServer.define("battle", BattleRoom);

// Health check for Render.com cold starts
app.get("/ping", (req, res) => res.send("pong"));

// Monitor for local dev
app.use("/colyseus", monitor());

gameServer.listen(port).then(() => {
  console.log(`[GameServer] Listening on ws://127.0.0.1:${port}`);
});
