/**
 * Settings repository - key/value storage for runtime configuration.
 */

import { randomUUID } from "node:crypto";
import type { settingsRegistry } from "@shared/settings-registry";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index";

const { settings } = schema;

export type SettingKey = Exclude<
  {
    [K in keyof typeof settingsRegistry]: (typeof settingsRegistry)[K]["kind"] extends "virtual"
      ? never
      : K;
  }[keyof typeof settingsRegistry],
  undefined
>;

export async function getSetting(
  key: SettingKey,
  userId: string = "default-user",
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(settings)
    .where(and(eq(settings.userId, userId), eq(settings.key, key)));
  return row?.value ?? null;
}

export async function getAllSettings(
  userId: string = "default-user",
): Promise<Partial<Record<SettingKey, string>>> {
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.userId, userId));
  return rows.reduce(
    (acc, row) => {
      acc[row.key as SettingKey] = row.value;
      return acc;
    },
    {} as Partial<Record<SettingKey, string>>,
  );
}

export async function setSetting(
  key: SettingKey,
  value: string | null,
  userId: string = "default-user",
): Promise<void> {
  const now = new Date().toISOString();

  if (value === null) {
    await db
      .delete(settings)
      .where(and(eq(settings.userId, userId), eq(settings.key, key)));
    return;
  }

  const [existing] = await db
    .select({ id: settings.id })
    .from(settings)
    .where(and(eq(settings.userId, userId), eq(settings.key, key)));

  if (existing) {
    await db
      .update(settings)
      .set({ value, updatedAt: now })
      .where(and(eq(settings.userId, userId), eq(settings.key, key)));
    return;
  }

  await db.insert(settings).values({
    id: randomUUID(),
    userId,
    key,
    value,
    createdAt: now,
    updatedAt: now,
  });
}
