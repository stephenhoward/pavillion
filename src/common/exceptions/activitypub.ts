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

class InvalidRepostPolicySettingsError extends Error {
  constructor(message?: string) {
    super(message || 'Invalid auto-repost policy settings: auto-repost reposts cannot be enabled without enabling auto-repost originals');
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

class AlreadyFollowingError extends Error {
  constructor(message?: string) {
    super(message || 'Already following this calendar');
  }
}

export {
  InvalidRemoteCalendarIdentifierError,
  InvalidRepostPolicyError,
  InvalidRepostPolicySettingsError,
  InvalidSharedEventUrlError,
  FollowRelationshipNotFoundError,
  RemoteCalendarNotFoundError,
  RemoteDomainUnreachableError,
  ActivityPubNotSupportedError,
  RemoteProfileFetchError,
  SelfFollowError,
  AlreadyFollowingError,
};
