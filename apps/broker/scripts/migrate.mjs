import { applyPostgresMigrations } from "@team-31/broker/postgres";
import { applyOpsMigrations } from "@team-31/ops";

// preDeploy en Render: nexo.* primero y después ops (telemetría y vistas del admin). Sin ops,
// ops.events no existe en producción y la telemetría se pierde. applyOpsMigrations termina con
// ops.refresh_views(), que crea las vistas cuyas tablas ya existen.
await applyPostgresMigrations({ databaseUrl: process.env.DATABASE_URL });
const applied = await applyOpsMigrations({ databaseUrl: process.env.DATABASE_URL });
console.log(`Migraciones del broker aplicadas. ops: ${applied.length ? applied.join(", ") : "sin pendientes"}.`);
