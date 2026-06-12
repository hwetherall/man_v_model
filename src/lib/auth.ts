import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "mvm_session";

function configuredPassword() {
  return process.env.MVM_PASSWORD ?? "";
}

function sessionValue(password: string) {
  return createHmac("sha256", password).update("man-v-model:v1").digest("hex");
}

export function isPasswordGateEnabled() {
  return configuredPassword().length > 0;
}

export function isCorrectPassword(candidate: string) {
  const password = configuredPassword();
  if (!password) return true;

  const candidateBuffer = Buffer.from(candidate);
  const passwordBuffer = Buffer.from(password);

  if (candidateBuffer.length !== passwordBuffer.length) return false;
  return timingSafeEqual(candidateBuffer, passwordBuffer);
}

export async function hasAppAccess() {
  const password = configuredPassword();
  if (!password) return true;

  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value === sessionValue(password);
}

export async function setAppSession() {
  const password = configuredPassword();
  if (!password) return;

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, sessionValue(password), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export async function clearAppSession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
