export function handleCastWake(
  request: Request,
  id: string,
  after: (work: () => Promise<void>) => void,
  root: string,
): Promise<Response>;
