import { MongoClient, ObjectId } from "mongodb";

let client;
let db;
let indexesReady = false;

export function toObjectId(id) {
  if (id instanceof ObjectId) return id;
  return new ObjectId(String(id));
}

export async function getDb(config) {
  if (db) return db;
  const uri = String(config?.mongoUri || "");
  if (!uri) throw new Error("MONGODB_URI is not set.");

  client = client || new MongoClient(uri, {});
  await client.connect();
  db = client.db(String(config?.mongoDbName || "shortlistr"));

  if (!indexesReady) {
    await Promise.all([
      db.collection("users").createIndex({ email: 1 }, { unique: true }),
      db.collection("user_state").createIndex({ userId: 1 }, { unique: true }),
      db.collection("shortlist_items").createIndex({ userId: 1, key: 1 }, { unique: true }),
      db.collection("shortlist_items").createIndex({ userId: 1, savedAt: -1 })
    ]);
    indexesReady = true;
  }

  return db;
}

export async function getCollections(config) {
  const database = await getDb(config);
  return {
    users: database.collection("users"),
    userState: database.collection("user_state"),
    shortlistItems: database.collection("shortlist_items")
  };
}
