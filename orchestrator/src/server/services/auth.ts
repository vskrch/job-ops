import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { badRequest, notFound, unauthorized } from "@infra/errors";
import { logger } from "@infra/logger";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "../db/index";
import { isEmailConfigured, sendPasswordResetEmail } from "./email";

const { users, passwordResetTokens, jobs, pipelineRuns, jobSearches } = schema;

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
}

export interface UserStats {
  totalJobs: number;
  readyJobs: number;
  appliedJobs: number;
  inProgressJobs: number;
  totalPipelineRuns: number;
  totalSearches: number;
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

function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
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

export async function updateUserProfile(
  userId: string,
  args: { name?: string; email?: string },
): Promise<UserProfile> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    throw notFound("User not found.");
  }

  const now = new Date().toISOString();
  const updateData: {
    name?: string | null;
    email?: string;
    updatedAt: string;
  } = {
    updatedAt: now,
  };

  if (args.name !== undefined) {
    updateData.name = args.name.trim() || null;
  }

  if (args.email !== undefined) {
    const normalizedEmail = args.email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      throw badRequest("A valid email address is required.");
    }
    if (normalizedEmail !== user.email) {
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, normalizedEmail));
      if (existing) {
        throw badRequest("A user with this email address already exists.");
      }
      updateData.email = normalizedEmail;
    }
  }

  await db.update(users).set(updateData).where(eq(users.id, userId));

  const updated = await getUserById(userId);
  if (!updated) throw notFound("User not found after update.");
  return updated;
}

export async function changeUserPassword(
  userId: string,
  args: { currentPassword: string; newPassword: string },
): Promise<{ success: boolean }> {
  if (!args.newPassword || args.newPassword.length < 6) {
    throw badRequest("New password must be at least 6 characters long.");
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    throw notFound("User not found.");
  }

  if (!verifyPassword(args.currentPassword, user.passwordHash)) {
    throw unauthorized("Current password does not match.");
  }

  const newHash = hashPassword(args.newPassword);
  const now = new Date().toISOString();

  await db
    .update(users)
    .set({ passwordHash: newHash, updatedAt: now })
    .where(eq(users.id, userId));

  return { success: true };
}

/**
 * Resolve the public base URL for password reset links.
 *
 * Derives from the server-side JOBOPS_PUBLIC_BASE_URL env var only — never
 * from client-supplied headers (Origin/Referer/Host), which would let an
 * attacker host the reset link and steal the token.
 */
export function resolvePublicBaseUrl(): string {
  const configured = process.env.JOBOPS_PUBLIC_BASE_URL?.trim();
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.origin;
      }
    } catch {
      // fall through to default
    }
    logger.warn(
      "JOBOPS_PUBLIC_BASE_URL is not a valid http(s) URL; falling back to localhost default",
    );
  }
  return "http://localhost:3001";
}

export async function createPasswordResetToken(args: {
  email: string;
}): Promise<{
  success: boolean;
  emailSent: boolean;
  devToken?: string;
  resetUrl?: string;
}> {
  const normalizedEmail = args.email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw badRequest("A valid email address is required.");
  }

  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, normalizedEmail));

  // Security best practice: don't reveal if user does not exist
  if (!user) {
    return { success: true, emailSent: false };
  }

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashResetToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString(); // 1 hour

  // Invalidate previous unused tokens for this user
  await db
    .update(passwordResetTokens)
    .set({ usedAt: now.toISOString() })
    .where(
      and(
        eq(passwordResetTokens.userId, user.id),
        isNull(passwordResetTokens.usedAt),
      ),
    );

  await db.insert(passwordResetTokens).values({
    id: randomUUID(),
    userId: user.id,
    tokenHash,
    expiresAt,
    usedAt: null,
    createdAt: now.toISOString(),
  });

  // Base URL comes from server config only — request headers are never
  // trusted for building reset links (host-header injection / takeover).
  const resetUrl = `${resolvePublicBaseUrl()}/reset-password?token=${rawToken}`;

  let emailSent = false;
  if (isEmailConfigured()) {
    const emailResult = await sendPasswordResetEmail(user.email, resetUrl);
    emailSent = emailResult.success;
  } else {
    logger.info("Password reset requested (SMTP not configured)", {
      email: normalizedEmail,
      emailSent: false,
    });
  }

  const isDev = process.env.NODE_ENV !== "production";
  return {
    success: true,
    emailSent,
    // The raw token is exposed to the caller ONLY in non-production
    // environments (e.g. local self-hosting without SMTP). In production
    // the token travels exclusively through the reset email.
    ...(isDev ? { devToken: rawToken, resetUrl } : {}),
  };
}

export async function verifyPasswordResetToken(
  rawToken: string,
): Promise<{ valid: boolean; email?: string; error?: string }> {
  if (!rawToken || typeof rawToken !== "string") {
    return { valid: false, error: "Reset token is required." };
  }

  const tokenHash = hashResetToken(rawToken.trim());
  const [tokenRecord] = await db
    .select({
      id: passwordResetTokens.id,
      userId: passwordResetTokens.userId,
      expiresAt: passwordResetTokens.expiresAt,
      usedAt: passwordResetTokens.usedAt,
      userEmail: users.email,
    })
    .from(passwordResetTokens)
    .innerJoin(users, eq(passwordResetTokens.userId, users.id))
    .where(eq(passwordResetTokens.tokenHash, tokenHash));

  if (!tokenRecord) {
    return { valid: false, error: "Invalid or unrecognized reset token." };
  }

  if (tokenRecord.usedAt) {
    return { valid: false, error: "This reset token has already been used." };
  }

  if (new Date(tokenRecord.expiresAt).getTime() < Date.now()) {
    return { valid: false, error: "This reset token has expired." };
  }

  return { valid: true, email: tokenRecord.userEmail };
}

export async function resetPasswordWithToken(args: {
  token: string;
  newPassword: string;
}): Promise<{ success: boolean }> {
  if (!args.newPassword || args.newPassword.length < 6) {
    throw badRequest("New password must be at least 6 characters long.");
  }

  const tokenHash = hashResetToken(args.token.trim());
  const [tokenRecord] = await db
    .select({
      id: passwordResetTokens.id,
      userId: passwordResetTokens.userId,
      expiresAt: passwordResetTokens.expiresAt,
      usedAt: passwordResetTokens.usedAt,
    })
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, tokenHash));

  if (!tokenRecord || tokenRecord.usedAt) {
    throw badRequest("Invalid or expired password reset token.");
  }

  if (new Date(tokenRecord.expiresAt).getTime() < Date.now()) {
    throw badRequest("This password reset token has expired.");
  }

  const now = new Date().toISOString();
  const passwordHash = hashPassword(args.newPassword);

  // Update password and mark token used
  await db
    .update(users)
    .set({ passwordHash, updatedAt: now })
    .where(eq(users.id, tokenRecord.userId));

  await db
    .update(passwordResetTokens)
    .set({ usedAt: now })
    .where(eq(passwordResetTokens.id, tokenRecord.id));

  return { success: true };
}

export async function getUserStats(userId: string): Promise<UserStats> {
  const [jobStats] = await db
    .select({
      totalJobs: sql<number>`count(*)`,
      readyJobs: sql<number>`sum(case when status = 'ready' then 1 else 0 end)`,
      appliedJobs: sql<number>`sum(case when status = 'applied' then 1 else 0 end)`,
      inProgressJobs: sql<number>`sum(case when status = 'in_progress' then 1 else 0 end)`,
    })
    .from(jobs)
    .where(eq(jobs.userId, userId));

  const [pipelineStats] = await db
    .select({
      totalRuns: sql<number>`count(*)`,
    })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.userId, userId));

  const [searchStats] = await db
    .select({
      totalSearches: sql<number>`count(*)`,
    })
    .from(jobSearches)
    .where(eq(jobSearches.userId, userId));

  return {
    totalJobs: jobStats?.totalJobs ?? 0,
    readyJobs: jobStats?.readyJobs ?? 0,
    appliedJobs: jobStats?.appliedJobs ?? 0,
    inProgressJobs: jobStats?.inProgressJobs ?? 0,
    totalPipelineRuns: pipelineStats?.totalRuns ?? 0,
    totalSearches: searchStats?.totalSearches ?? 0,
  };
}
