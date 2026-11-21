"use client";

export function settled(state: { error?: string }, pending: boolean, initial: object) {
  return pending || (state !== initial && !state.error);
}
