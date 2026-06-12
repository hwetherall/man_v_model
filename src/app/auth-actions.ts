"use server";

import { clearAppSession, isCorrectPassword, setAppSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export async function unlockApp(formData: FormData) {
  const password = String(formData.get("password") ?? "");

  if (!isCorrectPassword(password)) {
    redirect("/?auth=bad");
  }

  await setAppSession();
  redirect("/");
}

export async function lockApp() {
  await clearAppSession();
  redirect("/");
}
