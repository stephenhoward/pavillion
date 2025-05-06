import axios, { AxiosError } from 'axios';

interface JWTClaims {
    exp: number;
    isAdmin: boolean;
}

export default class AuthenticationService {
    localStore: Storage;
    _refresh_timer: NodeJS.Timeout | null;

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

    async login(email: string,password: string): Promise<boolean> {

        try {
            let response = await axios.post( this._authUrl('/login'), {
                email    : email,
                password : password
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

    async register(email: string) {

        try {
            let response = await axios.post( this._accountUrl('/register'), {
                email: email
            });

            return response.data;
        }
        catch (error) {
            throw( error );
        }
    }

    async register_apply(email: string, message: string) {
        try {
            let response = await axios.post( this._accountUrl('/applications'), {
                email: email,
                message: message
            });

            return response.data;
        }
        catch (error) {
            throw( error );
        }
    }

    async accept_invitation(code: string, password: string) {
        try {
            let response = await axios.post( this._accountUrl('/invitations/' + code), {
                code: code,
                password: password
            });

            return response.data;
        }
        catch (error) {
            throw( error );
        }
    }

    async resend_invitation(invitationId: string) {
        try {
            let response = await axios.post( this._accountUrl('/invitations/' + invitationId + '/resend'));
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

    async process_application(id: string, accepted: boolean, silent: boolean = false) {
        try {
            let response = await axios.post(this._accountUrl('/applications/' + id), {
                accepted: accepted,
                silent: silent
            });
            return response.data;
        } catch (error) {
            throw(error);
        }
    }

    logout() {
        this._unset_token();
    }

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

    async reset_password( email: string ) {

        if ( email == undefined || email == '' ) {
            throw("no_email_provided");
        }

        try {
            let response = await axios.post( this._authUrl('/reset-password'), {
                email: email
            });

            return response.data;

        }
        catch (error) {

            console.log(error);
            throw (error);
        }
    }

    async check_password_reset_token( token: string ) {

        if ( token == null || token == '' ) {
            throw("Must provide a password reset token");
        }

        try {
            let response = await axios.get( this._authUrl('/reset-password/' + token) );
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

    jwt() {
        return this.localStore.getItem('jwt');
    }

    _authUrl(path: string) {

        return '/api/auth/v1' + path;
    }
    _accountUrl(path: string) {

        return '/api/accounts/v1' + path;
    }

    async _wait(ms: number): Promise<NodeJS.Timeout> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

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

    _set_token(data: string) {
        this.localStore.setItem('jwt',data);

        let jw_token: JWTClaims = JSON.parse(
            atob( data.split('.')[1].replace('-','+').replace('_','/') )
        );
        this.localStore.setItem('jw_token', JSON.stringify(jw_token) );
        if ( jw_token.exp ) {
            this._refresh_login( jw_token.exp );
        }
    }

    _unset_token() {
        this.localStore.removeItem('jwt');
        this.localStore.removeItem('jw_token');
        if ( this._refresh_timer ) {
            clearTimeout(this._refresh_timer);
            this._refresh_timer = null;
        }
    }

}