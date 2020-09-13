#!/usr/bin/env node
'use strict';
const path = require('path')
const fs = require('fs')
const { yamlParse } = require('yaml-cfn');
const simplify = require('simplify-sdk')
const utilities = require('simplify-sdk/utilities')
const provider = require('simplify-sdk/provider')
var functionMeta = { lashHash256: null }
const opName = `executeCLI`

const getFunctionArn = function (functionName, locationFolder) {
    const outputFile = path.resolve(locationFolder, `${functionName}.json`)
    const outputData = JSON.parse(fs.readFileSync(outputFile))
    return outputData.data.FunctionArn
}

const getErrorMessage = function(error) {
    return error.message ? error.message : JSON.stringify(error)
}

const deployStack = function (options) {
    const { configFile, envFile, configStackFolder, configStackName } = options
    require('dotenv').config({ path: path.resolve(envFile || '.env') })
    var config = simplify.getInputConfig(path.resolve(configFile || 'config.json'))
    const stackConfigFile = path.resolve(config.OutputFolder, 'StackConfig.json')
    const stackYamlFile = path.resolve(configStackFolder, `${configStackName}.yaml`)
    if (!fs.existsSync(stackYamlFile)) {
        simplify.finishWithErrors(`${opName}-CheckTemplate`, `${stackYamlFile} not found.`)
    }
    config.FunctionName = `${process.env.FUNCTION_NAME}-${process.env.DEPLOYMENT_ENV}`
    const stackFullName = `${process.env.PROJECT_NAME || config.FunctionName}-${configStackName}`
    provider.setConfig(config).then(function () {
        simplify.uploadLocalFile({
            adaptor: provider.getStorage(),
            ...{ bucketKey: config.Bucket.Key, inputLocalFile: stackYamlFile }
        }).then(function (uploadInfo) {
            function processStackData(stackData) {
                let outputData = {}
                outputData[configStackName] = {}
                stackData.Outputs.map(function (o) {
                    outputData[configStackName][o.OutputKey] = o.OutputValue
                })
                if (fs.existsSync(stackConfigFile)) {
                    outputData = { ...outputData, ...JSON.parse(fs.readFileSync(stackConfigFile)) }
                }
                const pathDirName = path.dirname(path.resolve(stackConfigFile))
                if (!fs.existsSync(pathDirName)) {
                    fs.mkdirSync(pathDirName, { recursive: true })
                }
                fs.writeFileSync(stackConfigFile, JSON.stringify(outputData, null, 4))
                simplify.finishWithMessage(`${configStackName}`, `${outputData[configStackName].Endpoint || outputData[configStackName].Region}`)
                return outputData
            }
            function createStack(stackTemplate, parameters, stackPluginModule) {
                simplify.createOrUpdateStackOnComplete({
                    adaptor: provider.getResource(),
                    ...{
                        stackName: `${stackFullName}`,
                        stackParameters: {
                            Environment: `${process.env.DEPLOYMENT_ENV}`,
                            ...parameters
                        },
                        stackTemplate: stackTemplate
                    }
                }).then(function (stackData) {
                    if (stackPluginModule && typeof stackPluginModule.postCreation === 'function') {
                        stackPluginModule.postCreation({ simplify, provider, config }, configStackName, stackData).then(result => processStackData(result))
                        simplify.consoleWithMessage(`${opName}-PostCreation`, `${path.resolve(configStackFolder, `${configStackName}.js`)} - (Executed)`)
                    } else {
                        simplify.consoleWithMessage(`${opName}-PostCreation`, `${path.resolve(configStackFolder, `${configStackName}.js`)} - (Skipped)`)
                        processStackData(stackData)
                    }
                }).catch(error => {
                    simplify.finishWithErrors(`${opName}-Create${configStackName}`, getErrorMessage(error))
                })
            }
            function mappingParameters(docYaml, parameters) {
                let resultParameters = {}
                let resultErrors = null
                let stackOutputData = {}
                let stackParamteres = {}
                if (fs.existsSync(stackConfigFile)) {
                    stackOutputData = JSON.parse(fs.readFileSync(stackConfigFile))
                    Object.keys(stackOutputData).map(prefix => {
                        Object.keys(stackOutputData[prefix]).map(param => {
                            stackParamteres[`${prefix}${param}`] = stackOutputData[prefix][param]
                        })
                    })
                }
                Object.keys(docYaml.Parameters).map(paramName => {
                    resultParameters[paramName] = parameters[paramName] || stackParamteres[paramName] || docYaml.Parameters[paramName].Default
                    if (!resultParameters[paramName]) {
                        if (!resultErrors) resultErrors = []
                        resultErrors.push({
                            name : paramName,
                            type: docYaml.Parameters[paramName].Type
                        })
                    }
                })
                return { resultParameters, resultErrors }
            }
            var templateURL = uploadInfo.Location
            try {
                const docYaml = yamlParse(fs.readFileSync(stackYamlFile));
                var parameters = {
                    Environment: process.env.DEPLOYMENT_ENV,
                    FunctionName: config.FunctionName,
                    FunctionARN: getFunctionArn(config.FunctionName, config.OutputFolder)
                }
                var stackPluginModule = {}
                if (fs.existsSync(path.resolve(configStackFolder, `${configStackName}.js`))) {
                    stackPluginModule = require(path.resolve(configStackFolder, `${configStackName}`))
                }
                if (typeof stackPluginModule.preCreation === 'function') {
                    const { resultParameters  } = mappingParameters(docYaml, parameters)
                    stackPluginModule.preCreation({ simplify, provider, config }, configStackName, resultParameters).then(parameterResult => {
                        const { resultParameters, resultErrors } = mappingParameters(docYaml, parameterResult)
                        if (!resultErrors) {
                            simplify.consoleWithMessage(`${opName}-PreCreation`, `${path.resolve(configStackFolder, `${configStackName}.js`)} - (Executed)`)
                            createStack(templateURL, resultParameters, stackPluginModule)
                        } else {
                            resultErrors.map(error => {
                                simplify.consoleWithErrors(`${opName}-Verification`, `(${stackFullName}) name=${error.name} type=${error.type} is not set.`)
                            })
                        }
                    })
                } else {
                    const { resultParameters, resultErrors } = mappingParameters(docYaml, parameters)
                    if (!resultErrors) {
                        simplify.consoleWithMessage(`${opName}-PreCreation`, `${path.resolve(configStackFolder, `${configStackName}.js`)} - (Skipped)`)
                        createStack(templateURL, resultParameters, stackPluginModule)
                    } else {
                        resultErrors.map(error => {
                            simplify.consoleWithErrors(`${opName}-Verification`, `(${stackFullName}) name=${error.name} type=${error.type} is not set.`)
                        })
                    }
                }
            } catch (error) {
                simplify.finishWithErrors(`${opName}-LoadYAMLResource:`, getErrorMessage(error))
            }  
        })
    })
}

const destroyStack = function (options) {
    const { configFile, envFile, configStackFolder, configStackName } = options
    require('dotenv').config({ path: path.resolve(envFile || '.env') })
    var config = simplify.getInputConfig(path.resolve(configFile || 'config.json'))
    const stackConfigFile = path.resolve(config.OutputFolder, 'StackConfig.json')
    const stackList = fs.existsSync(stackConfigFile) ? JSON.parse(fs.readFileSync(stackConfigFile)) : {}
    provider.setConfig(config).then(function () {
        function deleteStack (stackName, stackPluginModule) {
            const stackFullName = `${process.env.PROJECT_NAME || config.FunctionName}-${stackName}`
            simplify.consoleWithMessage(`${opName}-CleanupResource`, `StackName - (${stackFullName})`)
            simplify.deleteStackOnComplete({
                adaptor: provider.getResource(),
                ...{
                    stackName: `${stackFullName}`,
                }
            }).then(function (stackData) {
                if (stackPluginModule && typeof stackPluginModule.postCleanup === 'function') {
                    stackPluginModule.postCleanup({ simplify, provider, config }, stackName, stackList, stackData).then(result => {
                        delete stackList[stackName]
                        fs.writeFileSync(stackConfigFile, JSON.stringify(stackList, null, 4))
                        simplify.consoleWithMessage(`${opName}-PostCleanup`, `${path.resolve(configStackFolder, `${stackName}.js`)} - (Executed)`)
                        simplify.finishWithMessage(`${stackName}`, `${stackConfigFile} - (Changed)`)
                    }).catch(function (error) {
                        simplify.finishWithErrors(`${opName}-CleanupResource:`, getErrorMessage(error))
                    })
                } else {
                    delete stackList[stackName]
                    fs.writeFileSync(stackConfigFile, JSON.stringify(stackList, null, 4))
                    simplify.consoleWithMessage(`${opName}-PostCleanup`, `${path.resolve(configStackFolder, `${stackName}.js`)} - (Skipped)`)
                    simplify.finishWithMessage(`${stackName}`, `${stackConfigFile} - (Changed)`)
                }
            }).catch(function (error) {
                simplify.finishWithErrors(`${opName}-CleanupResource:`, getErrorMessage(error))
            })
        }
        function deleteByStackName(stackName) {
            var stackPluginModule = {}
            if (fs.existsSync(path.resolve(configStackFolder, `${stackName}.js`))) {
                stackPluginModule = require(path.resolve(configStackFolder, `${stackName}`))
            }
            if (stackPluginModule && typeof stackPluginModule.preCleanup === 'function') {
                stackPluginModule.preCleanup({ simplify, provider, config }, stackName, stackList).then(stackName => {
                    simplify.consoleWithMessage(`${opName}-PreCleanup`, `${path.resolve(configStackFolder, `${stackName}.js`)} - (Executed)`)
                    deleteStack(stackName, stackPluginModule)
                }).catch(function (error) {
                    simplify.finishWithErrors(`${opName}-PreCleanup`, getErrorMessage(error))
                })
            } else {
                simplify.consoleWithMessage(`${opName}-PreCleanup`, `${path.resolve(configStackFolder, `${stackName}.js`)} - (Skipped)`)
                deleteStack(stackName, stackPluginModule)
            }
        }
        if (configStackName == "*" && fs.existsSync(stackConfigFile)) {
            Object.keys(stackList).forEach(function (stackName) {
                deleteByStackName(stackName)
            })
        } else {
            deleteByStackName(configStackName)
        }
    }).catch(function (error) {
        simplify.finishWithErrors(`${opName}-LoadCredentials`, getErrorMessage(error))
    })
}

const deployFunction = function (options) {
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
            } catch (error) {
                simplify.finishWithErrors(`${opName}-DeployLayer`, getErrorMessage(error));
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
                        simplify.consoleWithMessage(`${opName}-PublishFunction`, `Done: ${functionVersion.FunctionArn}`)
                    }).catch(err => simplify.finishWithErrors(`${opName}-PublishFunction-ERROR`, err))
                } else {
                    fs.writeFileSync(path.resolve(config.OutputFolder, `${config.Function.FunctionName}.json`), JSON.stringify(functionMeta, null, 4))
                    fs.writeFileSync(path.resolve(config.OutputFolder, `${config.Function.FunctionName}.hash`), functionMeta.uploadInfor.FileSha256)
                    simplify.consoleWithMessage(`${opName}-DeployFunction`, `Done: ${data.FunctionArn}`)
                }
            } else {
                simplify.consoleWithMessage(`${opName}-DeployFunction`, `Done: Your code is up to date!`)
            }
        }
    }).catch(error => simplify.finishWithErrors(`${opName}-UploadFunction-ERROR`, getErrorMessage(error))).catch(error => {
        simplify.consoleWithErrors(`${opName}-DeployFunction-ERROR`, getErrorMessage(error))
        throw error
    })
}

const destroyFunction = function (options) {
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
            simplify.consoleWithMessage(`${opName}-DestroyFunction`, `Done. ${data.FunctionName}`)
        })
    }).catch(error => simplify.finishWithErrors(`${opName}-DestroyFunction-ERROR`, getErrorMessage(error))).catch(error => {
        simplify.consoleWithErrors(`${opName}-DestroyFunction-ERROR`, getErrorMessage(error))
        throw error
    })
}

var argv = require('yargs').usage('simplify-cli init | deploy | destroy [options]')
    .string('template').describe('template', 'Init nodejs or python template').default('template', 'nodejs')
    .string('config').alias('c', 'config').describe('config', 'function configuration').default('config', 'config.json')
    .string('policy').alias('p', 'policy').describe('policy', 'function policy to attach').default('policy', 'policy.json')
    .string('role').alias('r', 'role').describe('role', 'function policy to attach').default('role', 'role.json')
    .string('source').alias('s', 'source').describe('source', 'function source to deploy').default('source', 'src')
    .string('env').alias('e', 'env').describe('env', 'environment variable file').default('env', '.env')
    .boolean('update').describe('update', 'force update function code').default('update', false)
    .boolean('publish').describe('publish', 'force publish with a version').default('publish', false)
    .boolean('layer').describe('layer', 'deploy source folder as layer').default('layer', false)
    .string('location').describe('location', 'stack folder to deploy').default('location', 'stacks')
    .string('stack-name').describe('stack-name', 'stack name to deploy')
    .string('composer').describe('composer', 'multistacks composer to deploy')
    .demandOption(['c', 'p', 's']).demandCommand(1).argv;

if (argv['stack-name'] !== undefined) {
    argv['stack-name'] = argv['stack-name'] ? argv['stack-name'] : '*'
}
var cmdOPS = (argv._[0] || 'deploy').toUpperCase()
if (cmdOPS === "DEPLOY") {
    if (argv['stack-name'] !== undefined) {
        deployStack({
            configFile: argv.config,
            envFile: argv.env,
            configStackFolder: argv.location,
            configStackName: argv['stack-name']
        })
    } else {
        deployFunction({
            configFile: argv.config,
            envFile: argv.env,
            roleFile: argv.role,
            policyFile: argv.policy,
            sourceDir: argv.source,
            forceUpdate: argv.update,
            asFunctionLayer: argv.layer,
            publishNewVersion: argv.publish
        })
    }

} else if (cmdOPS === "DESTROY") {
    if (argv['stack-name'] !== undefined) {
        destroyStack({
            configFile: argv.config,
            envFile: argv.env,
            configStackFolder: argv.location,
            configStackName: argv['stack-name']
        })
    } else {
        destroyFunction({
            configFile: argv.config,
            envFile: argv.env,
            withFunctionLayer: argv.layer
        })
    }
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

module.exports = {
    deployFunction,
    destroyFunction,
    deployStack,
    destroyStack
}
