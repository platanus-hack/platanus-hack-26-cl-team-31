# POC de Sideband

Referencia local del ciclo de solicitudes anterior al diseño del monorepo. Usa usuarios ficticios en `example.test`, estado en memoria y credenciales generadas para cada ejecución. El servidor prueba el flujo por MCP en un puerto de loopback asignado por el sistema. El watcher produce avisos con el ID de la solicitud para que el código que lo llama decida qué hacer.

Para ejecutar las pruebas con Node 24, desde la raíz del repositorio:

```sh
poc_dir="$(mktemp -d)"
cp docs/poc/*.mjs docs/poc/policy.json "$poc_dir/"
npm install --prefix "$poc_dir" @modelcontextprotocol/sdk@1.32.2 express@5.3.0 zod@3.25.76
node "$poc_dir/test-e2e.mjs"
node "$poc_dir/test-isolation.mjs"
```
