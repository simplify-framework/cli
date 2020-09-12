#!/usr/bin/env node
'use strict';
const path = require('path')
const fs = require('fs')
const simplify = require('simplify-sdk')
const utilities = require('simplify-sdk/utilities')
const provider = require('simplify-sdk/provider')
var functionMeta = { lashHash256: null }

const deploy = function (options) {
    const { configFile, envFile, roleFile, policyFile, sourceDir, forceUpdate, asFunctionLayer, publishNewVersion } = options
    require('dotenv').config({ path: path.resolve(envFile || '.env') })
    var config = simplify.getInputConfig(path.resolve(configFile || 'config.json'))
    var policyDocument = simplify.getContentFile(path.resolve(policyFile || 'policy.json'))
    var assumeRoleDocument = simplify.getContentFile(path.resolve(roleFile || 'role.json'))
    if (!fs.existsSync(path.resolve(config.OutputFolder))) {
        fs.mkdirSync(path.resolve(config.OutputFolder), { recursive: true })
    }
    if (fs.existsSync(path.resolve(config.OutputFolder, `${config.Function.FunctionName}.hash`))) {
        functionMeta.lashHash256 = fs.readFileSync(path.resolve(config.OutputFolder, `${config.Function.FunctionName}.hash`)).toString()
    }
    return provider.setConfig(config).then(_ => {
        const roleName = `${config.Function.FunctionName}Role`
        return simplify.createOrUpdateFunctionRole({
            adaptor: provider.getIAM(),
            roleName: roleName,
            policyDocument: policyDocument,
            assumeRoleDocument: JSON.stringify(assumeRoleDocument)
        })
    }).then(data => {
        functionMeta.functionRole = data.Role
        return simplify.uploadDirectoryAsZip({
            adaptor: provider.getStorage(),
            ...{
                bucketKey: config.Bucket.Key,
                inputDirectory: path.resolve(sourceDir || 'src'),
                outputFilePath: path.resolve('dist'),
                hashInfo: { FileSha256: forceUpdate ? 'INVALID' : functionMeta.lashHash256 }
            }
        })
    }).then(uploadInfor => {
        functionMeta.uploadInfor = uploadInfor
        config.Function.Role = functionMeta.functionRole.Arn
        if (!uploadInfor.isHashIdentical) {
            return asFunctionLayer ? simplify.createFunctionLayerVersion({
                adaptor: provider.getFunction(),
                ...{
                    layerConfig: {
                        "CompatibleRuntimes": [config.Function.Runtime],
                        "LayerName": config.Function.FunctionName
                    },
                    functionConfig: config.Function,
                    bucketName: config.Bucket.Name,
                    bucketKey: uploadInfor.Key
                }
            }) : simplify.createOrUpdateFunction({
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
        if (asFunctionLayer) {
            try {
                let configInput = JSON.parse(fs.readFileSync(path.resolve(configFile || 'config.json')))
                configInput.Function.Layers = data.Layers
                fs.writeFileSync(path.resolve(configFile || 'config.json'), JSON.stringify(configInput, null, 4))
<<<<<<< HEAD
            } catch (err) {
                simplify.finishWithErrors(`DeployLayer`, err);
=======
            } catch(err) {
                simplify.finishWithErrors(`DeployLayer`, err)
                throw err
>>>>>>> c848d9a4720fe9a25bc95c2a2c4022c1664f164a
            }
        } else {
            if (data && data.FunctionArn) {
                functionMeta = { ...functionMeta, data }
                if (publishNewVersion) {
                    simplify.publishFunctionVersion({
                        adaptor: provider.getFunction(),
                        ...{
                            functionConfig: config.Function,
                            functionMeta: functionMeta
                        }
                    }).then(functionVersion => {
                        functionMeta.data = functionVersion /** update versioned metadata */
                        fs.writeFileSync(path.resolve(config.OutputFolder, `${config.Function.FunctionName}.json`), JSON.stringify(functionMeta, null, 4))
                        fs.writeFileSync(path.resolve(config.OutputFolder, `${config.Function.FunctionName}.hash`), functionMeta.uploadInfor.FileSha256)
                        simplify.consoleWithMessage(`PublishFunction`, `Done: ${functionVersion.FunctionArn}`)
                    }).catch(err => simplify.finishWithErrors(`PublishFunction-ERROR`, err))
                } else {
                    fs.writeFileSync(path.resolve(config.OutputFolder, `${config.Function.FunctionName}.json`), JSON.stringify(functionMeta, null, 4))
                    fs.writeFileSync(path.resolve(config.OutputFolder, `${config.Function.FunctionName}.hash`), functionMeta.uploadInfor.FileSha256)
                    simplify.consoleWithMessage(`DeployFunction`, `Done: ${data.FunctionArn}`)
                }
            } else {
                simplify.consoleWithMessage(`DeployFunction`, `Done: Your code is up to date!`)
            }
        }
    }).catch(err => simplify.finishWithErrors(`UploadFunction-ERROR`, err)).catch(err => {
        simplify.consoleWithErrors(`DeployFunction-ERROR`, err)
        throw err
    })
}

const destroy = function (options) {
    const { configFile, envFile, withFunctionLayer } = options
    require('dotenv').config({ path: path.resolve(envFile || '.env') })
    var config = simplify.getInputConfig(path.resolve(configFile || 'config.json'))
    return provider.setConfig(config).then(_ => {
        const roleName = `${config.Function.FunctionName}Role`
        return simplify.deleteFunctionRole({
            adaptor: provider.getIAM(),
            roleName: roleName
        })
    }).then(_ => {
        return simplify.deleteFunction({
            adaptor: provider.getFunction(),
            functionConfig: config.Function,
            withLayerVersions: withFunctionLayer || false
        })
    }).then(data => {
        let configInput = JSON.parse(fs.readFileSync(path.resolve(configFile || 'config.json')))
        configInput.Function.Layers = []
        fs.writeFileSync(path.resolve(configFile || 'config.json'), JSON.stringify(configInput, null, 4))
        fs.unlinkSync(path.resolve(config.OutputFolder, `${config.Function.FunctionName}.hash`))
        fs.unlinkSync(path.resolve(config.OutputFolder, `${config.Function.FunctionName}.json`))
        return simplify.deleteDeploymentBucket({ adaptor: provider.getStorage(), bucketName: config.Bucket.Name }).then(function () {
            simplify.consoleWithMessage(`DestroyFunction`, `Done. ${data.FunctionName}`)
        })
    }).catch(err => simplify.finishWithErrors(`DestroyFunction-ERROR`, err)).catch(err => {
        simplify.consoleWithErrors(`DestroyFunction-ERROR`, err)
        throw err
    })
}

var argv = require('yargs').usage('simplify-cli init | deploy | destroy [options]')
    .string('config').alias('c', 'config').describe('config', 'function configuration').default('config', 'config.json')
    .string('policy').alias('p', 'policy').describe('policy', 'function policy to attach').default('policy', 'policy.json')
    .string('role').alias('r', 'role').describe('role', 'function policy to attach').default('role', 'role.json')
    .string('source').alias('s', 'source').describe('source', 'function source to deploy').default('source', 'src')
    .string('env').alias('e', 'env').describe('env', 'environment variable file').default('env', '.env')
    .boolean('update').alias('u', 'update').describe('update', 'force update function code').default('update', false)
    .boolean('publish').describe('publish', 'force publish with a version').default('publish', false)
    .boolean('layer').alias('l', 'layer').describe('layer', 'deploy source folder as layer').default('layer', false)
    .string('template').alias('t', 'template').describe('template', 'Init nodejs or python template').default('template', 'nodejs')
    .demandOption(['c', 'p', 's']).demandCommand(1).argv;

var cmdOPS = (argv._[0] || 'deploy').toUpperCase()
if (cmdOPS === "DEPLOY") {
    deploy({
        configFile: argv.config,
        envFile: argv.env,
        roleFile: argv.role,
        policyFile: argv.policy,
        sourceDir: argv.source,
        forceUpdate: argv.update,
        asFunctionLayer: argv.layer,
        publishNewVersion: argv.publish
    })
} else if (cmdOPS === "DESTROY") {
    destroy({
        configFile: argv.config,
        envFile: argv.env,
        withFunctionLayer: argv.layer
    })
} else if (cmdOPS === "INIT") {
    const inputDirectory = path.join(__dirname, argv.template)
    utilities.getFilesInDirectory(inputDirectory).then(function (files) {
        files.forEach(function (filePath) {
            var fileName = filePath.replace(inputDirectory, '').replace(/^\/+/, '').replace(/^\\+/, '')
            fs.readFile(filePath, function (err, data) {
                if (err) reject(err)
                else {
                    const pathDirName = path.dirname(path.resolve(fileName))
                    if (!fs.existsSync(pathDirName)) {
                        fs.mkdirSync(pathDirName, { recursive: true })
                    }
                    fs.writeFileSync(path.resolve(fileName.replace('dotenv', '.env')), fs.readFileSync(filePath))
                }
            })
        })
    })
    simplify.finishWithMessage(`Initialized`, `${path.resolve('.')}`)
}

module.exports = { deployFunction: deploy, destroyFunction: destroy }
