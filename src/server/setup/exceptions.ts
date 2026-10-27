class SetupAlreadyCompletedError extends Error {
  constructor() {
    super('Setup already completed');
  }
}

export {
  SetupAlreadyCompletedError,
};
