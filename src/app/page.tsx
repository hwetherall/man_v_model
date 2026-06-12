import { lockApp, unlockApp } from "@/app/auth-actions";
import { MvmApp } from "@/components/mvm-app";
import {
  hasAppAccess,
  isPasswordGateEnabled,
} from "@/lib/auth";
import { getDashboardData } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams: Promise<{ auth?: string }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;

  if (!(await hasAppAccess())) {
    return <LoginScreen badPassword={params.auth === "bad"} />;
  }

  try {
    const data = await getDashboardData();

    return (
      <MvmApp
        initialData={data}
        authControl={
          isPasswordGateEnabled() ? (
            <form action={lockApp}>
              <button className="inline-flex h-9 items-center rounded-md border border-neutral-700 px-3 text-sm text-neutral-200 transition hover:border-neutral-500 hover:bg-neutral-800">
                Lock
              </button>
            </form>
          ) : null
        }
      />
    );
  } catch (error) {
    return (
      <main className="min-h-screen bg-neutral-950 px-5 py-8 text-neutral-100">
        <div className="mx-auto max-w-3xl rounded-lg border border-red-900/60 bg-red-950/20 p-5">
          <p className="text-sm font-semibold text-red-200">Database setup needed</p>
          <h1 className="mt-2 text-2xl font-semibold">MvM could not load Supabase.</h1>
          <p className="mt-3 text-sm leading-6 text-neutral-300">
            {error instanceof Error ? error.message : "Unknown Supabase error."}
          </p>
          <p className="mt-3 text-sm leading-6 text-neutral-300">
            Run the schema, seed, `supabase/patch1.sql`, and `supabase/patch2.sql`,
            then refresh this page.
          </p>
        </div>
      </main>
    );
  }
}

function LoginScreen({ badPassword }: { badPassword: boolean }) {
  return (
    <main className="grid min-h-screen place-items-center bg-neutral-950 px-5 text-neutral-100">
      <form
        action={unlockApp}
        className="w-full max-w-sm rounded-lg border border-neutral-800 bg-neutral-900 p-5 shadow-2xl"
      >
        <p className="text-sm font-semibold text-emerald-300">Man v Model</p>
        <h1 className="mt-2 text-2xl font-semibold">Unlock cockpit</h1>
        <label className="mt-5 block text-sm text-neutral-300" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoFocus
          className="mt-2 h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-neutral-100 outline-none transition focus:border-emerald-400"
        />
        {badPassword ? (
          <p className="mt-3 text-sm text-red-300">That password did not match.</p>
        ) : null}
        <button className="mt-5 h-10 w-full rounded-md bg-emerald-500 px-3 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400">
          Unlock
        </button>
      </form>
    </main>
  );
}
