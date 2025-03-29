
  class InvalidUrlNameError extends Error {
      constructor() {
          super('Invalid url name');
      }
  }
  
  class UrlNameAlreadyExistsError extends Error {
      constructor() {
          super('url name already exists');
      }
  }
  
  export {
      InvalidUrlNameError,
      UrlNameAlreadyExistsError
   };