import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Dashboard } from "./dashboard";
import "./demo.css";

export const metadata: Metadata = {
  title: "Nexo — Laboratorio de coordinación",
  description: "Prueba cómo Nexo coordina asistentes sin compartir calendarios.",
  icons: { icon: "/nexo.svg" },
};

export default function DemoPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <Dashboard />;
}
