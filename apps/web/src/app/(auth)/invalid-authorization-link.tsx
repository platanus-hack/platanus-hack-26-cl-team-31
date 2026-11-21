export function InvalidAuthorizationLink() {
  return (
    <>
      <h1 className="text-[22px] leading-tight font-medium tracking-[-0.02em]">El enlace de autorización venció o no es válido</h1>
      <p className="mt-3 text-muted">Vuelve a iniciar la conexión desde tu agente.</p>
    </>
  );
}
