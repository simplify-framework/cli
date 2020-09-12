'use strict';
const path = require('path')
const fs = require('fs')
const opName = `Extension`
module.exports = {
    getParameters: function(parameters, config) {
        return {
            WebsiteBucketName: process.env.WEBSITE_BUCKET
        }
    },
    postCreation: function(adaptor, stackData, stackName) {
        const { simplify, provider, config } = adaptor
        const publicFolder = path.join(__dirname, "public-html")
        const outputConfig = path.join(config.OutputFolder, "website-config.json")
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
        })
        return Promise.resolve(stackData)
    },
    postCleanup: function(adaptor, stackData, stackName, stackResult) {
        const { simplify, provider, config } = adaptor
        return Promise.resolve(stackData)
    }
}