export function validateProductionSecrets(): void {
  const session = config.get('session.secret');
  if (!session) throw new Error('SESSION_SECRET must be set');
}
