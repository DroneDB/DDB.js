/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const Dataset = require('./dataset');

module.exports = class Organization {
    constructor(registry, org) {
        this.registry = registry;
        this.org = org;
    }

    async datasets() {
        return this.registry.getRequest(`/orgs/${this.org}/ds`);
    }

    async info(){
        return this.registry.getRequest(`/orgs/${this.org}/`);
    }

    Dataset(ds) {
        return new Dataset(this.registry, this.org, ds);
    }

    async createDataset(slug, name, isPublic = false) {
        let body = {
            slug: slug,
            name: name,
            isPublic: isPublic,
        };

        return await this.registry.postRequest(`/orgs/${this.org}/ds`, body);

    }

};
