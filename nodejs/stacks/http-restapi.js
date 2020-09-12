'use strict';
const path = require('path')
const fs = require('fs')
const opName = `Deployment`
const simplify = require('simplify-sdk')
const provider = require('simplify-sdk/provider')
var nodeArgs = process.argv.slice(2);
var configInputFile = process.env.DEPLOYMENT_CONFIG || 'config.json'
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })
while (nodeArgs.length > 0) {
    if (nodeArgs[0] == "--input" || nodeArgs[0] == "-i") {
        configInputFile = nodeArgs[1]
        nodeArgs = nodeArgs.slice(2);
    }
}
const getFunctionArn = function(functionName, locationFolder) {
    const outputFile = path.join(__dirname, locationFolder, `${functionName}.json`)
    const outputData = JSON.parse(fs.readFileSync(outputFile))
    return outputData.data.FunctionArn
}
try {
    var config = simplify.getContentArgs({
        "Profile": "${DEPLOYMENT_PROFILE}",
        "Region": "${DEPLOYMENT_REGION}",
        "Bucket": {
            "Name": "${DEPLOYMENT_BUCKET}",
            "Key": "builds/${DATE_TODAY}"
        },
        "OutputFolder": "../.simplify/${DEPLOYMENT_ENV}"
    })
    config.FunctionName = `${process.env.FUNCTION_NAME}-${process.env.DEPLOYMENT_ENV}`
    provider.setConfig(config).then(function () {
        simplify.uploadLocalFile({
            adaptor: provider.getStorage(),
            ...{ bucketKey: config.Bucket.Key, inputLocalFile: path.join(__dirname, "http-restapi.yaml") }
        }).then(function (uploadInfo) {
            function processStackData(stackData) {
                let outputData = {}
                const outputConfig = path.join(config.OutputFolder, "config.json")
                stackData.Outputs.map(function (o) {
                    if (o.OutputKey == `RestAPIGatewayURL`) {
                        outputData.RestAPIGatewayURL = o.OutputValue
                    } else if (o.OutputKey == `Region`) {
                        outputData.RestAPIGatewayRegion = o.OutputValue
                    } else if (o.OutputKey == `StackId`) {
                        outputData.RestAPIGatewayStackId = o.OutputValue
                    }
                })
                if (fs.existsSync(outputConfig)) {
                    outputData = { ...outputData, ... JSON.parse(fs.readFileSync(outputConfig)) }
                }
                const pathDirName = path.dirname(path.resolve(outputConfig))
                if (!fs.existsSync(pathDirName)) {
                    fs.mkdirSync(pathDirName, { recursive: true })
                }
                fs.writeFileSync(outputConfig, JSON.stringify(outputData, null, 4))
                simplify.finishWithMessage(`HttpRestApi URL`, `${outputData.RestAPIGatewayURL}`)
            }
            var TemplateURL = uploadInfo.Location
            var parameters = {
                Environment: process.env.DEPLOYMENT_ENV,
                HttpApiServerFunctionName: config.FunctionName,
                HttpApiServerFunctionArn: getFunctionArn(config.FunctionName, config.OutputFolder)
            }
            simplify.createOrUpdateStackOnComplete({
                adaptor: provider.getResource(),
                ...{
                    stackName: process.env.PROJECT_NAME || config.FunctionName,
                    stackParameters: {
                        Environment: `${process.env.DEPLOYMENT_ENV}`,
                        ...parameters
                    },
                    stackTemplate: TemplateURL
                }
            }).then(function (stackData) {
                processStackData(stackData)
            }).catch(error => {
                simplify.finishWithErrors(`${opName}-CreateHttpRestApi`, error)
            })
        })
    })
} catch (err) {
    simplify.finishWithErrors(`${opName}-LoadConfig`, err)
}