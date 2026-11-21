import type { Sharing } from "@team-31/protocol";

export function describeSharing(sharing: Sharing): string {
  const parts = [
    sharing.availability === "busy" && "Disponibilidad",
    sharing.availability === "slots" && "Horarios libres",
    sharing.interests && "Intereses",
    sharing.questions && "Preguntas abiertas",
  ].filter(Boolean);
  return parts.length === 0 ? "Nada" : parts.join(" · ");
}
