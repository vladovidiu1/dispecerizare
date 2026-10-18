import { connectDb, migrate } from "./db.js";
const db = connectDb();
try {
  await migrate(db);
  console.log("Database migrations complete");
} finally {
  await db.end();
}
