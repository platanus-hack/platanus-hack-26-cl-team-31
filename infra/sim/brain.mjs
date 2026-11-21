// La costura del "cerebro del titular".
//
// Un cerebro recibe un ítem de bandeja más el contexto de su titular y devuelve la respuesta que
// viaja en sideband_reply. Hoy hay una sola implementación, la guionizada de abajo. Mañana habrá
// otra que delegue en un CLI de agente con las credenciales de .env.local. Todo lo demás del
// arnés —alta de titulares, contactos, carga, invariantes y resumen— es común y no sabe cuál corre.
//
// Firma:
//   /** @typedef {(item: InboxItem, ctx: BrainContext) => Promise<Reply>} OwnerBrain */
//   BrainContext = {
//     owner: { name: string, address: string, userId: string },  // quien responde
//     from: string,                                              // dirección de quien pregunta
//     shares: Category[],                                        // lo que el titular le comparte
//     category: Category | undefined,                            // categoría que autorizó el broker
//     facts: Record<string, unknown>,                            // datos ficticios del titular
//     runId: string,
//   }
//   Reply = { outcome: "answered"|"no_data"|"needs_owner"|"declined",
//             result?: unknown, share?: Category[], internalReason?: string }
//
// Regla para la segunda implementación: lo que el cerebro decide es *contenido*, nunca invariante.
// Las comprobaciones de invariantes viven fuera y no se relajan porque haya un modelo en el bucle.

/**
 * Cerebro guionizado: determinista, sin modelo. Responde con los campos del esquema de cada tool.
 * @type {(item: any, ctx: any) => Promise<any>}
 */
export async function scriptedBrain(item, ctx) {
  switch (item.tool) {
    case "interest_check":
      return { outcome: "answered", result: { matches: ctx.facts.interests.includes(stripRun(item.args.interest)) } };
    case "availability": {
      const busy = ctx.facts.busyDates.includes(item.args.date);
      return busy
        ? { outcome: "answered", result: { available: false, freeSlots: [] } }
        : { outcome: "answered", result: { available: true, freeSlots: ["09:00-12:00", "15:00-18:00"] } };
    }
    case "question": {
      // El guion declina las preguntas abiertas para ejercitar un cierre que no es `answered`.
      if (item.args.category === "general") return { outcome: "declined", internalReason: "fuera de guion" };
      const answer = ctx.facts.answers[item.args.category];
      return answer === undefined
        ? { outcome: "no_data" }
        : { outcome: "answered", result: { answer } };
    }
    default:
      return { outcome: "no_data" };
  }
}

// El arnés marca cada pregunta con el identificador de la corrida para que dos corridas seguidas
// no choquen con el duplicado pendiente que el broker rechaza con 409.
function stripRun(value) {
  return String(value).replace(/\s*#[a-z0-9]+$/i, "");
}
