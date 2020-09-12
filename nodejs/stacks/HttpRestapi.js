'use strict';
const path = require('path')
const fs = require('fs')
const opName = `Extension`
module.exports = {
    getParameters: function(parameters, config) {
        return parameters
    },
    postCreation: function(adaptor, stackData, stackName) {
        const { simplify, provider, config } = adaptor
        return Promise.resolve(stackData)
    },
    postCleanup: function(adaptor, stackData, stackName, stackResult) {
        const { simplify, provider, config } = adaptor
        return Promise.resolve(stackData)
    }
}