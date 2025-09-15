import { Kafka } from "kafkajs";
import fs from "fs";

const kafka = new Kafka({
  clientId: "chat-app-admin",
  brokers: [process.env.KAFKA_BROKER],
  ssl: {
    rejectUnauthorized: true,
    ca: [fs.readFileSync("./ca.pem", "utf-8")],
  },
  sasl: {
    mechanism: "scram-sha-256", 
    username: process.env.KAFKA_USERNAME,
    password: process.env.KAFKA_PASSWORD,
  },
});

export { kafka };
