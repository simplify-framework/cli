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
        const GatewayIds = stackData.Outputs.map(output => {
            return output.OutputKey == 'GatewayId' ? output.OutputValue : undefined
        }).filter(x => x)
        /* UPDATE API GATEWAY FOR EACH SERVER WITH GATEWAY ID */
        GatewayIds.map(gatewayId => {
            simplify.updateAPIGatewayDeployment({
                adaptor: provider.getAPIGateway(),
                apiConfig: {
                    StageName: process.env.DEPLOYMENT_ENV || "demo",
                    GatewayId: gatewayId
                }
            }).then(function (data) {
                simplify.consoleWithMessage(`UpdateDeployment-OK`, `GatewayID: ${gatewayId} in ${process.env.DEPLOYMENT_ENV} stage`)
            }).catch(function (err) {
                simplify.consoleWithErrors(`UpdateDeployment-ERROR`, err)
            })
        })
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
