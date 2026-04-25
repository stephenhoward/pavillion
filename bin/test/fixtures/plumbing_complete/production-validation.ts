export function validateProductionSecrets(): void {
  const jwt = config.get('jwt.secret');
  const session = config.get('session.secret');
  if (!jwt) throw new Error('JWT_SECRET must be set');
  if (!session) throw new Error('SESSION_SECRET must be set');
}
