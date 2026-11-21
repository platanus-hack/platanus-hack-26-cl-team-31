// Identidad de los titulares de prueba de SIDEBAND_DEV_AUTH. La comparten /api/dev-login y
// /api/dev-token: el mismo nombre siempre resuelve al mismo correo, así que repetir cualquiera de
// las dos rutas reusa al titular en vez de crear uno nuevo.
export const DEV_DOMAIN = "sideband.local";

/** «Ana Pérez» → «ana-perez». Deja un correo estable por nombre. */
export function localPart(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Devuelve el correo del titular de prueba, o undefined si el nombre no sirve. */
export function devOwnerEmail(name: string): string | undefined {
  const local = localPart(name);
  if (!name || name.length > 100 || !local) return undefined;
  return `${local}@${DEV_DOMAIN}`;
}
