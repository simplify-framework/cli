'use strict';
const path = require('path')
const fs = require('fs')
const opName = `Extension`
module.exports = {
    preCreation: function(adaptor, stackName, mappedParameters, stackYAML, stackInputs) {
        return Promise.resolve({
            Environment: mappedParameters.Environment,
            WebsiteBucketName: process.env.WEBSITE_BUCKET
        })
    },
    postCreation: function(adaptor, stackName, stackData) {
        const { simplify, provider, config } = adaptor
        const publicFolder = path.join(__dirname, "public-html")
        const outputConfig = path.join(config.OutputFolder, "WebsiteConfig.json")
        return new Promise((resolve, reject) => {
            simplify.uploadLocalDirectory({
                adaptor: provider.getStorage(),
                ...{ publicACL: true, bucketName: process.env.WEBSITE_BUCKET, inputDirectory: publicFolder }
            }).then(function (uploadInfo) {
                const pathDirName = path.dirname(path.resolve(outputConfig))
                if (!fs.existsSync(pathDirName)) {
                    fs.mkdirSync(pathDirName, { recursive: true })
                }
                fs.writeFileSync(outputConfig, JSON.stringify(stackData, null, 4))
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
                bucketName: process.env.WEBSITE_BUCKET
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