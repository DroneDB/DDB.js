/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
const { Entry } = require('./entry');

module.exports = class Dataset{
    constructor(registry, org, ds){
        this.registry = registry;
        this.org = org;
        this.ds = ds;
    }

    remoteUri(path){
        const { remote, secure } = this.registry;

        const proto = secure ? "ddb" : "ddb+unsafe";
        const p = (path && path !== ".") ? `/${path}` : "";
        
        return `${proto}://${remote}/${this.org}/${this.ds}${p}`;
    }

    
    get baseApi(){
        return `/orgs/${this.org}/ds/${this.ds}`;
    }

    downloadUrl(paths, options = {}){
        if (typeof paths === "string") paths = [paths];

        let url = `${this.baseApi}/download`;

        let q = {};

        if (paths !== undefined){
            if (paths.length > 1) q.path = paths.join(",");
            else url += `/${paths[0]}`;
        }

        if (options.inline) q.inline = "1";
        q = new URLSearchParams(q).toString();
        if (q) url += `?${q}`;

        return url;
    }

    thumbUrl(path, size){
       if (!size) size = 256;

       let url = `/static/thumbs/${this.org}/${this.ds}/${size}/${encodeURIComponent(path)}`;

       return url;
    }

    tileUrl(path, tz, tx, ty, options = {}){
        
        let url = `/static/tiles/${this.org}/${this.ds}/${tz}/${tx}/${ty}/${options.retina ? 1 : 0}/${encodeURIComponent(path)}.png`;

        return url;
    }

    Entry (fileEntry){
        return new Entry(this, fileEntry);
    }

    async download(paths){
        return this.registry.postRequest(`${this.baseApi}/download`, { path: paths });
    }

    async getFileContents(path){
        const url = this.downloadUrl(path, { inline: true });
        return this.registry.getRequest(url);
    }
    
    async info(){
        return this.registry.getRequest(`${this.baseApi}`);
    }

    async list(path){
        return this.registry.postRequest(`${this.baseApi}/list`, { path });
    }

    async search(query){
        return this.registry.postRequest(`${this.baseApi}/search`, { query });
    }

    async delete(){
        return this.registry.deleteRequest(`${this.baseApi}`);
    }

    async deleteObj(path) {
        return this.registry.deleteRequest(`${this.baseApi}/obj`, { path });
    }

    async moveObj(source, dest) {
        return this.registry.putRequest(`${this.baseApi}/obj`, { source, dest });
    }

    async writeObj(path, content) {
        return this.registry.postRequest(`${this.baseApi}/obj`, { path, file: new Blob([content]) });
    }

    async createFolder(path) {
        return this.registry.postRequest(`${this.baseApi}/obj`, { path });
    }

    async rename(slug){
        if (typeof slug !== "string") throw new Error(`Invalid slug ${slug}`);
        return this.registry.postRequest(`${this.baseApi}/rename`, { slug });
    }

    async setPublic(flag){
        return this.registry.postRequest(`${this.baseApi}/chattr`, { attrs: JSON.stringify(
            { public: flag }
        )});
    }
 };
