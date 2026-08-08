import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { badRequest, unauthorized } from "@infra/errors";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index";

const { users } = schema;

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hashedPassword = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hashedPassword}`;
}

function verifyPassword(password: string, combinedHash: string): boolean {
  const [salt, key] = combinedHash.split(":");
  if (!salt || !key) return false;
  const hashedPassword = scryptSync(password, salt, 64);
  const keyBuffer = Buffer.from(key, "hex");
  return timingSafeEqual(hashedPassword, keyBuffer);
}

export async function createUser(args: {
  email: string;
  password: string;
  name?: string;
}): Promise<UserProfile> {
  const normalizedEmail = args.email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw badRequest("A valid email address is required.");
  }
  if (!args.password || args.password.length < 6) {
    throw badRequest("Password must be at least 6 characters long.");
  }

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalizedEmail));

  if (existing) {
    throw badRequest("A user with this email address already exists.");
  }

  const id = randomUUID();
  const passwordHash = hashPassword(args.password);
  const now = new Date().toISOString();

  await db.insert(users).values({
    id,
    email: normalizedEmail,
    passwordHash,
    name: args.name?.trim() || null,
    createdAt: now,
    updatedAt: now,
  });

  return {
    id,
    email: normalizedEmail,
    name: args.name?.trim() || null,
    createdAt: now,
  };
}

export async function authenticateUser(args: {
  email: string;
  password: string;
}): Promise<UserProfile> {
  const normalizedEmail = args.email.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail));

  if (!user || !verifyPassword(args.password, user.passwordHash)) {
    throw unauthorized("Invalid email or password.");
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
  };
}

export async function getUserById(id: string): Promise<UserProfile | null> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
  };
}
