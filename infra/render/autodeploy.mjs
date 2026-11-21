// Cron job de Render: despliega los servicios cuando cambia la rama de GitHub.
// El repo de la org es público, pero Render no tiene acceso a su webhook, así que en vez
// de autoDeploy comparamos el último commit de la rama con el último deploy de cada servicio.
// Sin dependencias: corre con `node infra/render/autodeploy.mjs` y solo usa fetch.

const { RENDER_API_KEY, AUTODEPLOY_REPO, AUTODEPLOY_BRANCH = "main", AUTODEPLOY_SERVICES } = process.env;
const api = "https://api.render.com/v1";

function required(name, value) {
  if (!value?.trim()) throw new Error(`Falta ${name}.`);
  return value.trim();
}

async function render(path, init = {}) {
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${required("RENDER_API_KEY", RENDER_API_KEY)}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!response.ok) throw new Error(`Render ${init.method ?? "GET"} ${path.split("?")[0]} respondió ${response.status}.`);
  return response.json();
}

// git smart HTTP (sin el límite de 60/h de la API de GitHub para IPs compartidas).
async function headCommit(repo, branch) {
  const response = await fetch(`${repo.replace(/\.git$/, "")}.git/info/refs?service=git-upload-pack`);
  if (!response.ok) throw new Error(`GitHub respondió ${response.status}.`);
  const ref = `refs/heads/${branch}`;
  for (const line of (await response.text()).split("\n")) {
    const match = line.match(/([0-9a-f]{40}) (\S+)/);
    if (match?.[2].replace(/\0.*$/, "") === ref) return match[1];
  }
  throw new Error(`No existe ${ref}.`);
}

async function serviceId(name) {
  const [item] = await render(`/services?name=${encodeURIComponent(name)}&limit=1`);
  if (!item?.service?.id) throw new Error(`No existe el servicio ${name}.`);
  return item.service.id;
}

async function main() {
  const repo = required("AUTODEPLOY_REPO", AUTODEPLOY_REPO);
  const names = required("AUTODEPLOY_SERVICES", AUTODEPLOY_SERVICES).split(",").map((name) => name.trim()).filter(Boolean);
  const sha = await headCommit(repo, AUTODEPLOY_BRANCH);
  console.log(`[autodeploy] ${AUTODEPLOY_BRANCH} está en ${sha.slice(0, 7)}.`);

  let failed = false;
  for (const name of names) {
    try {
      const id = await serviceId(name);
      const [latest] = await render(`/services/${id}/deploys?limit=1`);
      const deployed = latest?.deploy?.commit?.id;
      // Un deploy fallido del mismo commit no se reintenta: se corrige con otro merge o a mano.
      if (deployed === sha) {
        console.log(`[autodeploy] ${name}: ${sha.slice(0, 7)} ya tiene deploy (${latest.deploy.status}).`);
        continue;
      }
      const deploy = await render(`/services/${id}/deploys`, { method: "POST", body: JSON.stringify({ commitId: sha }) });
      console.log(`[autodeploy] ${name}: deploy ${deploy.id ?? ""} de ${sha.slice(0, 7)} (antes ${deployed?.slice(0, 7) ?? "ninguno"}).`);
    } catch (error) {
      failed = true;
      console.error(`[autodeploy] ${name}: ${error instanceof Error ? error.message : "falló."}`);
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[autodeploy] ${error instanceof Error ? error.message : "Falló."}`);
  process.exitCode = 1;
});
