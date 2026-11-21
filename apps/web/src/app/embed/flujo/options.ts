// Parámetros de /embed/flujo. Valores fuera de rango vuelven al valor por defecto.
export interface EmbedOptions {
  autoPlay: boolean;
  loop: boolean;
  speed: number;
  controls: boolean;
  panels: boolean;
  presence: boolean;
  owners?: string[];
}

const flag = (value: string | null, fallback: boolean) => (value === null ? fallback : !["0", "false", "no"].includes(value.toLowerCase()));

export function parseEmbedOptions(params: Pick<URLSearchParams, "get">): EmbedOptions {
  const speed = Number(params.get("speed"));
  const owners = (params.get("owners") ?? "")
    .split(",")
    .map((owner) => owner.trim())
    .filter((owner) => /^[\w.@+-]{1,64}$/.test(owner))
    .slice(0, 12);
  return {
    autoPlay: flag(params.get("autoplay"), true),
    loop: flag(params.get("loop"), true),
    speed: Number.isFinite(speed) && speed >= 0.25 && speed <= 4 ? speed : 1,
    controls: flag(params.get("controls"), true),
    panels: flag(params.get("panels"), true),
    presence: flag(params.get("presence"), true),
    ...(owners.length > 0 ? { owners } : {}),
  };
}
