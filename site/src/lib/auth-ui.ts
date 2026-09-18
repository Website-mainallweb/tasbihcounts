"use client";

import { useSyncExternalStore } from "react";

import { hasSessionCookie } from "@/lib/session-cookie";

/**
 * The sign-in popup is opened from anywhere — the header, the promo bar, a card
 * on a page — without those places importing the popup itself. They fire this
 * event; AuthDialog listens. The popup's code (and the Supabase client inside
 * it) is fetched only when it is first opened.
 */
export type AuthTab = "login" | "premium";

export const AUTH_EVENT = "njc:auth";

export function openAuth(tab: AuthTab = "login"): void {
  window.dispatchEvent(new CustomEvent<AuthTab>(AUTH_EVENT, { detail: tab }));
}

const noSubscribe = () => () => {};
const readSession = () => hasSessionCookie(document.cookie, process.env.NEXT_PUBLIC_SUPABASE_URL);

/**
 * Whether this browser holds a session cookie. Presence only — it decides which
 * button the header shows, never what anyone may see; every signed-in page
 * checks the user on the server.
 */
export function useHasSession(): boolean {
  return useSyncExternalStore(noSubscribe, readSession, () => false);
}
