import { randomUUID } from "node:crypto";
import { connectDb, migrate, transaction } from "./db.js";
import { hashPassword } from "./security.js";
const { ADMIN_EMAIL, ADMIN_PASSWORD, ORGANIZATION_NAME } = process.env;
if (
  !ADMIN_EMAIL ||
  !ADMIN_PASSWORD ||
  ADMIN_PASSWORD.length < 12 ||
  !ORGANIZATION_NAME
)
  throw new Error(
    "Set ORGANIZATION_NAME, ADMIN_EMAIL, ADMIN_PASSWORD (12+ characters)",
  );
const db = connectDb();
try {
  await migrate(db);
  const result = await transaction(db, async (c) => {
    if (
      (
        await c.query("SELECT 1 FROM users WHERE email=$1", [
          ADMIN_EMAIL.toLowerCase(),
        ])
      ).rowCount
    )
      throw new Error(
        "Administrator already exists; bootstrap will not overwrite it",
      );
    const organizationId = randomUUID(),
      userId = randomUUID();
    await c.query("INSERT INTO organizations(id,name) VALUES($1,$2)", [
      organizationId,
      ORGANIZATION_NAME,
    ]);
    await c.query(
      "INSERT INTO users(id,organization_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5,'admin')",
      [
        userId,
        organizationId,
        "Administrator",
        ADMIN_EMAIL.toLowerCase(),
        hashPassword(ADMIN_PASSWORD),
      ],
    );
    return { organizationId, userId };
  });
  console.log(JSON.stringify(result));
} finally {
  await db.end();
}
