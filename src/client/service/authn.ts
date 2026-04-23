import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import { ref, Ref } from 'vue';

import { SessionExpiredError } from '@/common/exceptions/authentication';

interface JWTClaims {
  exp: number;
  isAdmin: boolean;
  email: string;
}

interface PendingRequest {
  config: AxiosRequestConfig;
  resolve: (value: AxiosResponse) => void;
  reject: (reason: unknown) => void;
}

export default class AuthenticationService {
  localStore: Storage;
  _refresh_timer: NodeJS.Timeout | null;
  sessionExpired: Ref<boolean>;
  lastKnownEmail: string | null;
  _pendingRequests: PendingRequest[];
  _requestInterceptorId: number;
  _responseInterceptorId: number;

  /**
   * Constructor.
   * Sets up axios interceptors to include JWT token in all requests
   * and to capture 401 responses into a pending-request queue so the
   * session-expired modal can drain or abort them once resolved.
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
    this.sessionExpired = ref(false);
    this.lastKnownEmail = null;
    this._pendingRequests = [];

    this._requestInterceptorId = axios.interceptors.request.use( (config) => {
      let jwt = this.jwt();
      if ( jwt ) {
        config.headers['Authorization'] = 'Bearer ' + jwt;
      }
      return config;
    });

    // Response interceptor: on 401 from a non-auth endpoint, queue the original
    // request and flip the sessionExpired flag so the modal opens. On 401 from
    // /api/auth/* endpoints (login/refresh/forgot-password), pass the error
    // through so form-level errors still surface. Retrying queued requests is
    // safe for all HTTP methods because the server rejects pre-handler on 401,
    // so the original mutation never ran.
    //
    // Replayed requests (marked with _retry) short-circuit this interceptor so
    // that a still-401 replay never re-enters the queue and reopens the modal,
    // which would trap the user in a loop.
    this._responseInterceptorId = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if ((error?.config as any)?._retry) {
          return Promise.reject(error);
        }
        const status = error?.response?.status;
        const url = error?.config?.url ?? '';
        const isAuthEndpoint = url.startsWith('/api/auth/');
        if (status !== 401 || isAuthEndpoint) {
          return Promise.reject(error);
        }
        return new Promise<AxiosResponse>((resolve, reject) => {
          this._pendingRequests.push({ config: error.config, resolve, reject });
          this.sessionExpired.value = true;
        });
      },
    );
  }

  /**
   * Replays every queued 401'd request in order. The existing request
   * interceptor re-injects the fresh Bearer token on each retried call.
   * Resolves the original promise with the retry's response (or rejects
   * it with the retry's error). Finally clears the sessionExpired flag,
   * which un-mounts the modal.
   */
  async drainPendingRequests(): Promise<void> {
    const queue = this._pendingRequests.splice(0);
    for (const { config, resolve, reject } of queue) {
      try {
        // Mark replay so the response interceptor short-circuits instead of
        // re-queuing if the replay itself gets a 401 (avoids modal-reopen loop).
        const retryConfig = { ...config, _retry: true } as AxiosRequestConfig;
        resolve(await axios.request(retryConfig));
      }
      catch (err) {
        reject(err);
      }
    }
    this.sessionExpired.value = false;
  }

  /**
   * Rejects every queued request with a `SessionExpiredError` and clears
   * the sessionExpired flag. Called when the user dismisses the modal
   * without logging back in.
   */
  abortPendingRequests(): void {
    const queue = this._pendingRequests.splice(0);
    for (const { reject } of queue) {
      reject(new SessionExpiredError());
    }
    this.sessionExpired.value = false;
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
      this.lastKnownEmail = email;
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
   * Revokes (cancels) a pending account invitation.
   *
   * @param {string} id - ID of the invitation to revoke
   * @returns {Promise<any>} Response data from the server
   * @throws Will throw the response status code or error if revocation fails
   */
  async revoke_invitation(id: string) {
    try {
      let response = await axios.delete( this._accountUrl('/invitations/' + id));
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
   * @returns {Promise<{valid: boolean, isNewAccount?: boolean}>} Token validation result
   * @throws Will throw an error if token is null or empty or request fails
   */
  async check_password_reset_token( token: string ): Promise<{valid: boolean, isNewAccount?: boolean}> {

    if ( token == null || token == '' ) {
      throw("Must provide a password reset token");
    }

    try {
      let response = await axios.get( this._authUrl('/reset-password/' + token) );
      if (response.data.valid === true) {
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

    return '/api/v1' + path;
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
        // Surface the session-expired modal on the user's next visible
        // interaction for backgrounded tabs whose silent refresh failed.
        this.sessionExpired.value = true;
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
    this.lastKnownEmail = null;
    if ( this._refresh_timer ) {
      clearTimeout(this._refresh_timer);
      this._refresh_timer = null;
    }
  }

}
