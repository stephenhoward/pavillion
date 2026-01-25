import axios, { AxiosError } from 'axios';

interface JWTClaims {
  exp: number;
  isAdmin: boolean;
  email: string;
}

export default class AuthenticationService {
  localStore: Storage;
  _refresh_timer: NodeJS.Timeout | null;

  /**
   * Constructor.
   * Sets up axios interceptors to include JWT token in all requests.
   *
   * @param {Storage} localStore - Storage interface for persisting authentication data
   * @throws Will throw an error if localStore is not provided
   */
  constructor(localStore: Storage) {

    if ( localStore == null ) {
      throw("Must provide a localStorage object");
    }

    this.localStore = localStore;

    const jwt = this.localStore.getItem('jwt');

    if ( jwt ) {
      this._set_token( jwt );
    }

    this._refresh_timer = null;

    axios.interceptors.request.use( (config) => {
      let jwt = this.jwt();
      if ( jwt ) {
        config.headers['Authorization'] = 'Bearer ' + jwt;
      }
      return config;
    });
  }

  /**
   * Authenticates a user with the provided credentials.
   * Stores JWT token upon successful authentication.
   *
   * @param {string} email - User's email address
   * @param {string} password - User's password
   * @returns {Promise<boolean>} True if login was successful, false otherwise
   * @throws Will throw an error if server returns an error other than 400
   */
  async login(email: string,password: string): Promise<boolean> {

    try {
      let response = await axios.post( this._authUrl('/login'), {
        email    : email,
        password : password,
      });
      this._set_token(response.data);
      return response.data;
    }
    catch(error) {
      this._unset_token();
      if ( error.status == 400 ) {
        return false;
      }
      else {
        throw( error );
      }
    }
    return true;
  }

  /**
   * Registers a new user with the provided email.
   *
   * @param {string} email - Email address for registration
   * @returns {Promise<any>} Response data from the server
   * @throws Will throw an error if registration fails
   */
  async register(email: string) {

    try {
      let response = await axios.post( this._accountUrl('/register'), {
        email: email,
      });

      return response.data;
    }
    catch (error) {
      throw( error );
    }
  }

  /**
   * Submits an application for a new account with email and a message.
   *
   * @param {string} email - Applicant's email address
   * @param {string} message - Application message/reason
   * @returns {Promise<any>} Response data from the server
   * @throws Will throw an error if application submission fails
   */
  async register_apply(email: string, message: string) {
    try {
      let response = await axios.post( this._accountUrl('/applications'), {
        email: email,
        message: message,
      });

      return response.data;
    }
    catch (error) {
      throw( error );
    }
  }

  /**
   * Accepts an account invitation using the provided code and sets a password.
   *
   * @param {string} code - Invitation code
   * @param {string} password - New password to set
   * @returns {Promise<any>} Response data from the server
   * @throws Will throw an error if accepting invitation fails
   */
  async accept_invitation(code: string, password: string) {
    try {
      let response = await axios.post( this._accountUrl('/invitations/' + code), {
        code: code,
        password: password,
      });

      return response.data;
    }
    catch (error) {
      throw( error );
    }
  }

  /**
   * Resends an account invitation to the user.
   *
   * @param {string} id - ID of the invitation to resend
   * @returns {Promise<any>} Response data from the server
   * @throws Will throw the response status code or error if resending fails
   */
  async resend_invitation(id: string) {
    try {
      let response = await axios.post( this._accountUrl('/invitations/' + id + '/resend'));
      return response.data;
    }
    catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        if (axiosError.response) {
          throw(axiosError.response.status);
        }
      }
      throw(error);
    }
  }

  /**
   * Validates an invitation token/code.
   *
   * @param {string} code - Invitation code to validate
   * @returns {Promise<any>} Response data from the server with invitation details
   * @throws Will throw an error if the code is invalid or empty
   */
  async check_invite_token(code: string) {
    if (!code || code === '') {
      throw("no_invite_code_provided");
    }

    try {
      let response = await axios.get(this._accountUrl('/invitations/' + code));
      return response.data;
    }
    catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        if (axiosError.response) {
          throw(axiosError.response.status);
        }
      }
      throw(error);
    }
  }

  /**
   * Accept or reject an account application.
   *
   * @param {string} id - Application ID
   * @param {boolean} accepted - Whether the application is accepted
   * @param {boolean} silent - Whether to process rejections silently without notifications
   * @returns {Promise<any>} Response data from the server
   * @throws Will throw an error if processing fails
   */
  async process_application(id: string, accepted: boolean, silent: boolean = false) {
    try {
      let response = await axios.post(this._accountUrl('/applications/' + id), {
        accepted: accepted,
        silent: silent,
      });
      return response.data;
    }
    catch (error) {
      throw(error);
    }
  }

  /**
   * Logs out the current user by removing authentication tokens.
   */
  logout() {
    this._unset_token();
  }

  /**
   * Checks if a user is currently logged in with a valid token.
   *
   * @returns {boolean} True if user is logged in with non-expired token
   */
  isLoggedIn() {
    let token =  this.localStore.getItem('jw_token');

    if ( token ) {
      const claims: JWTClaims = JSON.parse(token);
      if ( token && claims.exp > Math.floor(Date.now() / 1000) ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Retrieves the current user's settings from JWT claims.
   *
   * @returns {JWTClaims|null} User settings from JWT claims or null if not logged in
   */
  userSettings() {
    let token =  this.localStore.getItem('jw_token');

    if ( token ) {
      const claims: JWTClaims = JSON.parse(token);
      if ( claims.exp > Math.floor(Date.now() / 1000) ) {
        return claims;
      }
    }
    return null;
  }

  /**
   * Checks if the current user has admin privileges.
   *
   * @returns {boolean} True if user has admin privileges
   */
  isAdmin() {
    let token =  this.localStore.getItem('jw_token');

    if ( token ) {
      const claims: JWTClaims = JSON.parse(token);
      if ( claims.exp > Math.floor(Date.now() / 1000) ) {
        return claims.isAdmin == true;
      }
    }
    return false;
  }

  /**
   *
   * @returns {string|null} The email address of the current user or null if not logged in
   */
  userEmail() {
    let token =  this.localStore.getItem('jw_token');

    if ( token ) {
      const claims: JWTClaims = JSON.parse(token);
      if ( claims.exp > Math.floor(Date.now() / 1000) ) {
        return claims.email;
      }
    }
    return null;
  }

  /**
   * Initiates a password reset process for the given email.
   *
   * @param {string} email - Email address for password reset
   * @returns {Promise<any>} Response data from the server
   * @throws Will throw an error if email is not provided or request fails
   */
  async reset_password( email: string ) {

    if ( email == undefined || email == '' ) {
      throw("no_email_provided");
    }

    try {
      let response = await axios.post( this._authUrl('/reset-password'), {
        email: email,
      });

      return response.data;

    }
    catch (error) {

      console.log(error);
      throw (error);
    }
  }

  async changeEmail ( email: string, password: string ): Promise<boolean> {
    try {
      let response = await axios.post(
        this._authUrl('/email'),
        { email, password },
      );
      if ( response.status === 200 ) {
        await this._refresh_login( this.userSettings().exp );
        return true;
      }
    }
    catch {
      // TODO: something more useful here
    }
    return false;
  }

  /**
   * Validates a password reset token.
   *
   * @param {string} token - Password reset token to validate
   * @returns {Promise<boolean>} True if token is valid, false otherwise
   * @throws Will throw an error if token is null or empty or request fails
   */
  async check_password_reset_token( token: string ): Promise<{valid: boolean, isNewAccount?: boolean}> {

    if ( token == null || token == '' ) {
      throw("Must provide a password reset token");
    }

    try {
      let response = await axios.get( this._authUrl('/reset-password/' + token) );
      if (response.data.message == 'ok') {
        return {
          valid: true,
          isNewAccount: response.data.isNewAccount,
        };
      }
      return { valid: false };
    }
    catch (error) {
      if ( axios.isAxiosError(error) ) {
        const axiosError = error as AxiosError;
        if ( axiosError.response ) {
          throw(axiosError.response.status);
        }
      }
      return { valid: false };
    }
  }

  /**
   * Uses a password reset token to set a new password.
   *
   * @param {string} token - Password reset token
   * @param {string} password - New password to set
   * @returns {Promise<any>} Response data from the server
   * @throws Will throw an error if token or password is not provided or request fails
   */
  async use_password_reset_token( token: string, password: string ) {

    if ( token == null || token == '' ) {
      throw("no_token_provided");
    }

    if ( password == null || password == '' ) {
      throw("no_password_provided");
    }

    try {
      let response = await axios.post( this._authUrl('/reset-password/' + token), { password: password });
      return response.data;
    }
    catch (error) {
      if ( axios.isAxiosError(error) ) {
        const axiosError = error as AxiosError;
        if ( axiosError.response ) {
          throw(axiosError.response.status);
        }
      }
    }
  }

  /**
   * Gets the JWT token from local storage.
   *
   * @returns {string|null} The JWT token or null if not present
   */
  jwt() {
    return this.localStore.getItem('jwt');
  }

  /**
   * Utility function that builds authentication API URL with the given path.
   *
   * @param {string} path - API path to append to base URL
   * @returns {string} Complete authentication API URL
   * @private
   */
  _authUrl(path: string) {

    return '/api/auth/v1' + path;
  }

  /**
   * Utility function that builds accounts API URL with the given path.
   *
   * @param {string} path - API path to append to base URL
   * @returns {string} Complete account API URL
   * @private
   */
  _accountUrl(path: string) {

    return '/api/accounts/v1' + path;
  }

  /**
   * Utility function that creates a promise that resolves after the specified time.
   *
   * @param {number} ms - Time to wait in milliseconds
   * @returns {Promise<NodeJS.Timeout>} Promise that resolves after the timeout
   * @private
   */
  async _wait(ms: number): Promise<NodeJS.Timeout> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Refreshes the login token before it expires.
   *
   * @param {number} timeout - Expiration timestamp in seconds
   * @returns {Promise<void>}
   * @private
   */
  async _refresh_login(timeout:number) {

    let timer = timeout - Math.floor(Date.now() / 1000) - 20;

    if ( timer > 0 ) {

      try {
        this._refresh_timer = await this._wait( timer * 1000 );
        if ( this.jwt() ) {
          let response = await axios.get( this._authUrl('/token'), {} );

          if ( response.status >= 400 ) {
            throw(response.statusText);
          }

          this._set_token(response.data);
        }
      }
      catch (error) {
        this._unset_token();
        throw( error );
      }
    }
    else {
      this._unset_token();
    }
  }

  /**
   * Stores the JWT token and sets up jwt token refresh from the server.
   *
   * @param {string} data - The JWT token string
   * @private
   */
  _set_token(data: string) {
    this.localStore.setItem('jwt',data);

    let jw_token: JWTClaims = JSON.parse(
      atob( data.split('.')[1].replace('-','+').replace('_','/') ),
    );
    this.localStore.setItem('jw_token', JSON.stringify(jw_token) );
    if ( jw_token.exp ) {
      this._refresh_login( jw_token.exp );
    }
  }

  /**
   * Removes authentication tokens and clears refresh timer.
   *
   * @private
   */
  _unset_token() {
    this.localStore.removeItem('jwt');
    this.localStore.removeItem('jw_token');
    if ( this._refresh_timer ) {
      clearTimeout(this._refresh_timer);
      this._refresh_timer = null;
    }
  }

}
