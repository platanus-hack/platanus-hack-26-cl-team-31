export function handleContactWake(
  request: Request,
  id: string,
  after: (work: () => Promise<void>) => void,
  root: string,
): Promise<Response>;
