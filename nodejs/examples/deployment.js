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
            ...{ bucketKey: config.Bucket.Key, inputLocalFile: path.join(__dirname, "application.yaml") }
        }).then(function (uploadInfo) {
            function processStackData(stackData) {
                let websiteURL = null
                let httpServerURL = null
                stackData.Outputs.map(function (o) {
                    if (o.OutputKey == `WebsiteURL`) {
                        websiteURL = o.OutputValue
                    } else if (o.OutputKey == `HttpApiServerUrl`) {
                        httpServerURL = o.OutputValue
                    }
                })
                const publicFolder = path.join(__dirname, "html")
                fs.writeFileSync(path.join(publicFolder, "config.json"), JSON.stringify({
                    ServerURL: httpServerURL
                }, null, 4))
                simplify.uploadLocalDirectory({
                    adaptor: provider.getStorage(),
                    ...{ publicACL: true, bucketName: process.env.WEBSITE_BUCKET, inputDirectory: publicFolder }
                }).then(function (uploadInfo) {
                    simplify.consoleWithMessage(`${opName}-CreateApplication`, `Uploaded - ${uploadInfo.length} files`)
                    simplify.finishWithMessage(`Website URL`, `${websiteURL}`)
                })
            }
            var TemplateURL = uploadInfo.Location
            var parameters = {
                Environment: process.env.DEPLOYMENT_ENV,
                WebsiteBucketName: process.env.WEBSITE_BUCKET,
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
                simplify.finishWithErrors(`${opName}-CreateApplication`, error)
            })
        })
    })
} catch (err) {
    simplify.finishWithErrors(`${opName}-LoadConfig`, err)
}