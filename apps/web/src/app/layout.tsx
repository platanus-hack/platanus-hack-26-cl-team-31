import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nexo — Laboratorio de coordinación",
  description: "Prueba cómo Nexo coordina asistentes sin compartir calendarios.",
  icons: { icon: "/nexo.svg" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-CL">
      <body>{children}</body>
    </html>
  );
}
