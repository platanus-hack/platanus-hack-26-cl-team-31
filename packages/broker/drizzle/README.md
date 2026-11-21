# Postgres del broker

Aplica las migraciones con `applyPostgresMigrations({ databaseUrl })` antes de abrir el Store. La función usa el schema `sideband`, registra las migraciones aplicadas y serializa ejecuciones concurrentes en la base. Incluye este directorio junto con `dist/` cuando empaquetes el servicio.

En instalaciones con roles separados, crea el rol del broker y aplica las migraciones con el rol dueño del schema mediante `applyPostgresMigrations({ databaseUrl, runtimeRole })`. La función otorga los permisos que el Store necesita. Conecta el Store con la URL del rol de ejecución, sin permisos de DDL ni membresía en el rol dueño. El rol de ejecución puede insertar y leer eventos. El trigger también impide modificaciones y borrados con el usuario local de Docker.

`createPostgresStore({ databaseUrl, secretsKey })` recibe una clave de 32 bytes en base64 (el valor de `WAKE_SECRETS_KEY`). Mantén la misma clave entre reinicios para poder leer las conexiones existentes y espera `store.close()` al apagar el servicio.

Una rama larga numera sus migraciones en un rango que `main` no usa y las renombra después de generarlas (`0200`/`0201` ya lo hacen, esta rama usa `0300`/`0301`). Si no, cada integración de `main` las choca de nombre y hay que renumerarlas de nuevo. El nombre del snapshot decide cuál es la punta: el rango alto también deja `drizzle-kit generate` comparando contra la migración más reciente.

Para generar migraciones a partir de cambios al schema, ejecuta `pnpm --filter @team-31/protocol build` desde la raíz y el siguiente comando desde `packages/broker`.

```sh
pnpm --package=drizzle-kit@0.31.11 --package=drizzle-orm@0.45.4 dlx drizzle-kit generate --dialect postgresql --schema ./src/store/postgres/schema.ts --out ./drizzle --name nombre_del_cambio
```
