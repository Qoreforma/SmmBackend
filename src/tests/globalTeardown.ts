import { MongoMemoryReplSet } from "mongodb-memory-server";

export default async function globalTeardown() {
  const instance: MongoMemoryReplSet = (global as any).__MONGOINSTANCE__;

  if (instance) {
    console.log("\n🛑 Stopping MongoDB Replica Set...");
    await instance.stop();
    console.log(" Replica Set stopped\n");
  }
}