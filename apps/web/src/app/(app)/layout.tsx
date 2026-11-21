import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { getOwnerAccount } from "@/lib/auth-owner";

import { AccountMenu } from "./account-menu";
import { Brand } from "./brand";
import { Navigation, PageBar } from "./nav";
import { ListSkeleton, Skeleton } from "./ui";

export const metadata: Metadata = {
  title: "Sideband",
  description: "Gestiona tus solicitudes, reglas y agentes en Sideband.",
};

type OwnerAccount = Awaited<ReturnType<typeof getOwnerAccount>>;

function profile({ user, address, displayName }: OwnerAccount) {
  return address ? { name: displayName || user.name || address, address, email: user.email, image: user.image } : undefined;
}

async function HeaderAccount({ account }: { account: Promise<OwnerAccount> }) {
  const value = profile(await account);
  return value && <div className="ml-auto"><AccountMenu account={value} compact /></div>;
}

async function Sidebar({ account }: { account: Promise<OwnerAccount> }) {
  const value = profile(await account);
  return value && (
    <aside className="px-4 pb-2 sm:px-6 lg:sticky lg:top-0 lg:h-dvh lg:w-[248px] lg:shrink-0 lg:overflow-hidden lg:border-r lg:border-line lg:px-0 lg:pb-0 lg:transition-[width,opacity,border-color] lg:duration-300 lg:ease-[cubic-bezier(0.22,1,0.36,1)] lg:in-data-[sidebar=closed]:w-0 lg:in-data-[sidebar=closed]:border-transparent lg:in-data-[sidebar=closed]:opacity-0">
      <div className="lg:flex lg:h-full lg:w-[248px] lg:flex-col lg:px-3 lg:pb-3">
        <Link href="/" aria-label="Sideband, inicio" className="-mx-3 mb-3 hidden h-[60px] items-center border-b border-line px-5 lg:flex"><Brand /></Link>
        <Navigation />
        <div className="mt-auto hidden lg:block"><AccountMenu account={value} /></div>
      </div>
    </aside>
  );
}

// Not async on purpose: awaiting the account here would hold back the page, so its data would only
// start loading after the account arrived. Both now load in parallel and still appear together,
// because the only Suspense boundary is the one around Workspace.
function Workspace({ children }: { children: ReactNode }) {
  const account = getOwnerAccount();

  return (
    <div className="group/workspace lg:flex">
      <header className="sticky top-0 z-20 bg-canvas/90 backdrop-blur-md lg:group-has-[aside]/workspace:hidden">
        <div className="flex h-[60px] items-center gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="Sideband, inicio" className="rounded-full"><Brand /></Link>
          <div className="ml-auto lg:hidden"><HeaderAccount account={account} /></div>
        </div>
      </header>
      <Sidebar account={account} />
      <div className="min-w-0 flex-1">
        <PageBar />
        <main id="contenido" className="px-4 pt-4 pb-20 sm:px-6 lg:px-10 lg:pt-8">{children}</main>
      </div>
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="lg:flex">
      <div aria-hidden="true" className="hidden h-dvh w-[248px] shrink-0 flex-col gap-2 border-r border-line px-3 lg:flex">
        <div className="-mx-3 mb-3 flex h-[60px] items-center border-b border-line px-5"><Skeleton className="h-5 w-28" /></div>
        {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-9 w-full rounded-xl" />)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="hidden h-[60px] items-center border-b border-line px-4 lg:flex"><Skeleton className="h-4 w-24" /></div>
        <div className="px-4 pt-4 sm:px-6 lg:px-10 lg:pt-8"><ListSkeleton rows={5} /></div>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas font-sans text-ink">
      <a href="#contenido" className="sr-only rounded-full bg-menu px-4 py-2 text-sm focus:not-sr-only focus:absolute focus:z-30 focus:m-3">Saltar al contenido</a>
      <Suspense fallback={<ShellSkeleton />}>
        <Workspace>{children}</Workspace>
      </Suspense>
    </div>
  );
}
