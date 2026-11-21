"use client";

import { button, card } from "./ui";

export default function AppError({ reset }: { reset: () => void }) {
  return (
    <section className={`${card} mx-auto mt-10 max-w-lg space-y-4 p-6`}>
      <h1 className="text-2xl font-semibold tracking-tight">No pudimos cargar esta página</h1>
      <button type="button" onClick={reset} className={button}>Volver a intentar</button>
    </section>
  );
}
