import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Dashboard } from "./dashboard";
import "./demo.css";

export const metadata: Metadata = {
  title: "Sideband — Laboratorio de coordinación",
  description: "Prueba cómo Sideband coordina asistentes sin compartir calendarios.",
};

export default function DemoPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <Dashboard />;
}
