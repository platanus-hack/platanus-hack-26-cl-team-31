import { BrokerError } from "@team-31/protocol";

export { BrokerError };
export function notFound(): BrokerError {
  return new BrokerError("not_found", "No se encontró el recurso.");
}

export function activeAgentConflict(): BrokerError {
  return new BrokerError("conflict", "Ya tienes un agente conectado. Desconéctalo en Agentes antes de conectar otro.");
}
