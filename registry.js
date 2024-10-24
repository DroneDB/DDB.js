/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const Organization = require('./organization');
const {DEFAULT_REGISTRY} = require('./constants');

let refreshTimers = {};

const throwError = (msg, status, extraData = {}) => {
    const e = new Error(msg);
    e.status = status;
    Object.assign(e, extraData);
    throw e;
};

// Credit https://stackoverflow.com/a/38552302
function parseJwt(token) {
    if (!token) return {};
    var base64Url = token.split('.')[1];
    var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    var jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));

    return JSON.parse(jsonPayload);
}

module.exports = class Registry {
    constructor(url = "https://" + DEFAULT_REGISTRY) {
        this.url = url;
        this.eventListeners = {};
    }

    get remote() {
        return this.url.replace(/^https?:\/\//, "");
    }

    get tagUrl() {
        // Drop the https prefix if it's secure (it's the default)
        return this.secure ? this.remote : this.url;
    }

    get secure() {
        return this.url.startsWith("https://");
    }

    // Login 
    async login(username, password, xAuthToken = null) {
        const formData = new FormData();
        if (username) formData.append("username", username);
        if (password) formData.append("password", password);
        if (xAuthToken) formData.append("token", xAuthToken);

        try {
            const res = await fetch(`${this.url}/users/authenticate`, {
                method: 'POST',
                body: formData
            }).then(r => r.json());

            if (res.token) {
                this.setCredentials(res.username, res.token, res.expires);
                this.setAutoRefreshToken();
                this.emit("login", res.username);

                return res;
            } else {
                throw new Error(res.error || `Cannot login: ${JSON.stringify(res)}`);
            }
        } catch (e) {
            throw new Error(`Cannot login: ${e.message}`);
        }
    }

    async storageInfo() {
        if (this.isLoggedIn()) {
            const res = await this.getRequest(`/users/storage`);

            if (res.total == null) {
                return {
                    total: null,
                    used: res.used
                };
            } else {
                return {
                    total: res.total,
                    used: res.used,
                    free: res.total - res.used,
                    usedPercentage: res.used / res.total
                };
            }

        } else {
            throw new Error("not logged in");
        }
    }

    async users() {
        return await this.getRequest(`/users`);
    }

    async userRoles() {
        return await this.getRequest(`/users/roles`);
    }

    async addUser(username, password, roles = []) {
        return await this.postRequest('/users', {
            username, password, roles: JSON.stringify(roles)
        });
    }

    async deleteUser(username) {
        return await this.deleteRequest(`/users/${encodeURIComponent(username)}`);
    }

    async changePwd(oldPassword, newPassword) {
        const res = await this.postRequest('/users/changePwd', {
            oldPassword, newPassword
        });
        if (res.token) {
            this.setCredentials(this.getUsername(), res.token, res.expires);
        } else {
            throwError(res.error || `Cannot change password: ${JSON.stringify(res)}`, res.status);
        }
    }

    async refreshToken() {
        if (this.isLoggedIn()) {
            const f = await fetch(`${this.url}/users/authenticate/refresh`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.getAuthToken()}`
                }
            });
            const res = await f.json();

            if (res.token) {
                this.setCredentials(this.getUsername(), res.token, res.expires);
            } else {
                throwError(res.error || `Cannot refresh token: ${JSON.stringify(res)}`, f.status);
            }
        } else {
            throw new Error("logged out");
        }
    }

    setAutoRefreshToken(seconds = 3600) {
        if (refreshTimers[this.url]) {
            clearTimeout(refreshTimers[this.url]);
            delete refreshTimers[this.url];
        }

        setTimeout(async () => {
            try {
                await this.refreshToken();
                this.setAutoRefreshToken(seconds);
            } catch (e) {
                console.error(e);

                // Try again later, unless we're logged out
                if (e.message !== "logged out") {
                    this.setAutoRefreshToken(seconds);
                }
            }
        }, seconds * 1000);
    }

    logout() {
        this.clearCredentials();
        this.emit("logout");
    }

    setCredentials(username, token, expires) {
        localStorage.setItem(`${this.url}_username`, username);
        localStorage.setItem(`${this.url}_jwt_token`, token);
        localStorage.setItem(`${this.url}_jwt_token_expires`, expires);

        // Set cookie if the URL matches the current window
        if (typeof window !== "undefined") {
            if (window.location.origin === this.url) {
                document.cookie = `jwtToken=${token};${expires * 1000};path=/`;
            }
        }
    }

    getAuthToken() {
        if (this.getAuthTokenExpiration() > new Date()) {
            return localStorage.getItem(`${this.url}_jwt_token`);
        }
    }

    getUsername() {
        if (this.isLoggedIn()) {
            return localStorage.getItem(`${this.url}_username`);
        }
    }

    isAdmin() {
        if (this.isLoggedIn()) {

            const token = this.getAuthToken();
            if (!token)
                return false;

            const decoded = parseJwt(token);
            if (!decoded)
                return false;

            return decoded.admin;
        }
    }

    getAuthTokenExpiration() {
        const expires = localStorage.getItem(`${this.url}_jwt_token_expires`);
        if (expires) {
            return new Date(expires * 1000);
        }
    }

    async createOrganization(slug, name, description, isPublic) {

        if (!this.isLoggedIn())
            throw new Error("not logged in");

        return await this.postRequest(`/orgs`, {
            slug,
            name,
            description,
            isPublic
        });
    }

    async updateOrganization(slug, name, description, isPublic) {
        if (!this.isLoggedIn())
            throw new Error("not logged in");

        return await this.putRequest(`/orgs/${slug}`, {
            slug: slug,
            name,
            description,
            isPublic
        });
    }

    async getOrganizations() {
        const res = await this.getRequest(`/orgs`);
        return res.map(org => new Organization(this, org));

    }

    async deleteOrganization(orgSlug) {

        if (!this.isLoggedIn())
            throw new Error("not logged in");

        return await this.deleteRequest(`/orgs/${orgSlug}`);
    }

    clearCredentials() {
        localStorage.removeItem(`${this.url}_jwt_token`);
        localStorage.removeItem(`${this.url}_jwt_token_expires`);
        localStorage.removeItem(`${this.url}_username`);

        // Clear cookie if the needed
        if (typeof window !== "undefined") {
            if (window.location.origin === this.url) {
                document.cookie = `jwtToken=;-1;path=/`;
            }
        }
    }

    isLoggedIn() {
        const loggedIn = this.getAuthToken() !== null && this.getAuthTokenExpiration() > new Date();
        if (!loggedIn) this.clearCredentials();
        return loggedIn;
    }

    async makeRequest(endpoint, method = "GET", body = null) {
        const headers = {};
        const authToken = this.getAuthToken();

        if (authToken) headers.Authorization = `Bearer ${authToken}`;

        const options = {
            method,
            headers
        };

        if (body) {
            const formData = new FormData();
            for (let k in body) {
                if (Array.isArray(body[k]))
                    body[k].forEach(v => formData.append(k, v));
                else
                    formData.append(k, body[k]);

            }
            options.body = formData;
        }

        const response = await fetch(`${this.url}${endpoint}`, options);
        if (response.status === 204) return true;
        else if (response.status === 401) {
            const contentType = response.headers.get("Content-Type");
            if (contentType && contentType.indexOf("application/json") !== -1) {
                let json = await response.json();
                throwError(json.error || "Unauthorized", 401, json);
            } else {
                throwError("Unauthorized", 401);
            }
        }
        else if (response.status === 404) throwError("Not found", 404);
        else if (method === "HEAD" && response.status === 200) return true;
        else {
            const contentType = response.headers.get("Content-Type");
            if (contentType && contentType.indexOf("application/json") !== -1) {
                let json = await response.json();
                if (json.error) throwError(json.error, response.status);

                if (response.status === 200 || response.status === 201) return json;
                else throwError(`Server responded with: ${JSON.stringify(json)}`, response.status);
            } else if (contentType && contentType.indexOf("text/") !== -1) {
                let text = await response.text();
                if (response.status === 200 || response.status === 201) return text;
                else throwError(`Server responded with: ${text}`, response.status);
            } else {
                throwError(`Server responded with: ${await response.text()}`, response.status);
            }
        }
    }

    async getRequest(endpoint) {
        return this.makeRequest(endpoint, "GET");
    }

    async postRequest(endpoint, body = {}) {
        return this.makeRequest(endpoint, "POST", body);
    }

    async putRequest(endpoint, body = {}) {
        return this.makeRequest(endpoint, "PUT", body);
    }

    async deleteRequest(endpoint, body = {}) {
        return this.makeRequest(endpoint, "DELETE", body);
    }

    async headRequest(endpoint) {
        return this.makeRequest(endpoint, "HEAD");
    }

    Organization(name) {
        return new Organization(this, name);
    }

    addEventListener(event, cb) {
        this.eventListeners[event] = this.eventListeners[event] || [];
        if (!this.eventListeners[event].find(e => e === cb)) {
            this.eventListeners[event].push(cb);
        }
    }

    removeEventListener(event, cb) {
        this.eventListeners[event] = this.eventListeners[event] || [];
        this.eventListeners[event] = this.eventListeners[event].filter(e => e !== cb);
    }

    emit(event, ...params) {
        if (this.eventListeners[event]) {
            this.eventListeners[event].forEach(listener => {
                listener(...params);
            });
        }
    }
}