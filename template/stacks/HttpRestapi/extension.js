'use strict';
const path = require('path')
const fs = require('fs')
const opName = `Extension`
module.exports = {
    preCreation: function(adaptor, stackName, mappedParameters, stackYAML, stackInputs) {
        return Promise.resolve(mappedParameters)
    },
    postCreation: function(adaptor, stackName, stackData) {
        const { simplify, provider, config } = adaptor
        return Promise.resolve(stackData)
    },
    preCleanup: function(adaptor, stackName, stackList) {
        const { simplify, provider, config } = adaptor
        return Promise.resolve(stackName)
    },
    postCleanup: function(adaptor, stackName, stackList, stackData) {
        const { simplify, provider, config } = adaptor
        return Promise.resolve(stackData)
    }
}