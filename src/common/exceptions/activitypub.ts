// Validation Errors

class InvalidRemoteCalendarIdentifierError extends Error {
  constructor(message?: string) {
    super(message || 'Invalid remote calendar identifier format. Expected username@domain');
  }
}

class InvalidRepostPolicyError extends Error {
  constructor(message?: string) {
    super(message || 'Invalid auto-repost policy value');
  }
}

class InvalidSharedEventUrlError extends Error {
  constructor(message?: string) {
    super(message || 'Invalid event URL for sharing');
  }
}

// Not Found Errors

class FollowRelationshipNotFoundError extends Error {
  constructor(message?: string) {
    super(message || 'Follow relationship not found');
  }
}

class RemoteCalendarNotFoundError extends Error {
  constructor(message?: string) {
    super(message || 'Remote calendar not found');
  }
}

// WebFinger/Federation Errors

class RemoteDomainUnreachableError extends Error {
  constructor(message?: string) {
    super(message || 'Cannot connect to remote domain');
  }
}

class ActivityPubNotSupportedError extends Error {
  constructor(message?: string) {
    super(message || 'Remote server does not support ActivityPub');
  }
}

class RemoteProfileFetchError extends Error {
  constructor(message?: string) {
    super(message || 'Failed to fetch remote actor profile');
  }
}

// Operation Errors

class SelfFollowError extends Error {
  constructor(message?: string) {
    super(message || 'Calendar cannot follow itself');
  }
}

export {
  InvalidRemoteCalendarIdentifierError,
  InvalidRepostPolicyError,
  InvalidSharedEventUrlError,
  FollowRelationshipNotFoundError,
  RemoteCalendarNotFoundError,
  RemoteDomainUnreachableError,
  ActivityPubNotSupportedError,
  RemoteProfileFetchError,
  SelfFollowError,
};
