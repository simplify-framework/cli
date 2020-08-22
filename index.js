'use strict';
require('dotenv').config()
const path = require('path')
const fs = require('fs')
const simplify = require('simplify-sdk')
const provider = require('simplify-sdk/provider')
var functionMeta = { lashHash256: null }
var config = simplify.getInputConfig(path.join(__dirname, 'config.json'))
var policyDocument = simplify.getContentFile(path.join(__dirname, "policy.json"))
if (fs.existsSync(path.join(__dirname, ".hash"))) {
    functionMeta.lashHash256 = fs.readFileSync(path.join(__dirname, ".hash")).toString()
}
provider.setConfig(config).then(_ => {
    const roleName = `${config.Function.FunctionName}Role`
    return simplify.createOrUpdateFunctionRole({
        adaptor: provider.getIAM(),
        roleName: roleName,
        policyDocument: policyDocument,
        assumeRoleDocument: null
    })
}).then(data => {
    functionMeta.functionRole = data.Role
    return simplify.uploadDirectoryAsZip({
        adaptor: provider.getStorage(),
        ...{
            bucketKey: config.Bucket.Key,
            inputDirectory: process.env.FUNCTION_SOURCE || 'src',
            outputFilePath: 'dist',
            hashInfo: { FileSha256: functionMeta.lashHash256 }
        }
    })
}).then(uploadInfor => {
    functionMeta.uploadInfor = uploadInfor
    config.Function.Role = functionMeta.functionRole.Arn
    if (!uploadInfor.isHashIdentical) {
        fs.writeFileSync(path.join(__dirname, ".hash"), uploadInfor.FileSha256)
        return simplify.createOrUpdateFunction({
            adaptor: provider.getFunction(),
            ...{
                functionConfig: config.Function,
                bucketName: config.Bucket.Name,
                bucketKey: uploadInfor.Key
            }
        })
    } else {
        return Promise.resolve({ ...config.Function })
    }
}).then(function (data) {
    if (data.FunctionArn) {
        functionMeta = { ...functionMeta, data }
        fs.writeFileSync(path.join(__dirname, ".output"), JSON.stringify(functionMeta, null, 4))
        simplify.consoleWithMessage(`uploadFunction`, `Done: ${data.FunctionArn}`)    
    } else {
        simplify.consoleWithMessage(`uploadFunction`, `Done: Your code is up to date!`)
    }
}).catch(err => simplify.finishWithErrors(`UploadFunction-ERROR`, err)).catch(err => {
    simplify.consoleWithErrors(`uploadFunction-ERROR`, err);
})