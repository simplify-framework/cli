'use strict';
const path = require('path')
const fs = require('fs')
const opName = `Extension`
module.exports = {
    preCreation: function(adaptor, stackName, mappedParameters, stackYAML, stackInputs) {
        return Promise.resolve({
            Environment: mappedParameters.Environment,
            WebsiteBucketName: `${process.env.PROJECT_NAME}-website`
        })
    },
    postCreation: function(adaptor, stackName, stackData) {
        const { simplify, provider, config } = adaptor
        const publicFolder = path.join(__dirname, "public-html")
        const outputConfig = path.join(publicFolder, "WebsiteConfig.json")
        const stackConfigFile = path.resolve(config.OutputFolder, 'StackConfig.json')
        if (fs.existsSync(stackConfigFile)) {
            const stackData = JSON.parse(fs.readFileSync(stackConfigFile))
            const outputData = {
                ServerURL: stackData['HttpRestapi'].Endpoint,
                ...stackData['CognitoUser']
            }
            fs.writeFileSync(outputConfig, JSON.stringify(outputData, null, 4))
        }
        return new Promise((resolve, reject) => {
            simplify.uploadLocalDirectory({
                adaptor: provider.getStorage(),
                ...{ publicACL: true, bucketName: `${process.env.PROJECT_NAME}-website`, inputDirectory: publicFolder }
            }).then(function (uploadInfo) {
                const pathDirName = path.dirname(path.resolve(outputConfig))
                if (!fs.existsSync(pathDirName)) {
                    fs.mkdirSync(pathDirName, { recursive: true })
                }
                simplify.consoleWithMessage(`${opName}-CreateWebsite`, `Uploaded - ${uploadInfo.length} files`)
                resolve(stackData)
            }).catch(error => reject(error))
        })
    },
    preCleanup: function(adaptor, stackName, stackList) {
        const { simplify, provider, config } = adaptor
        return new Promise((resolve, reject) => {
            simplify.deleteStorageBucket({
                adaptor: provider.getStorage(),
                bucketName: `${process.env.PROJECT_NAME}-website`
            }).then(function () {
                resolve(stackName)
            }).catch(err => reject(err))
        })
    },
    postCleanup: function(adaptor, stackName, stackList, stackData) {
        const { simplify, provider, config } = adaptor
        return Promise.resolve(stackData)
    }
}