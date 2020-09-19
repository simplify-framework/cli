#!/usr/bin/env node
'use strict';
const path = require('path')
const fs = require('fs')
const fetch = require('node-fetch')
const { yamlParse } = require('yaml-cfn');
const simplify = require('simplify-sdk')
const utilities = require('simplify-sdk/utilities')
const provider = require('simplify-sdk/provider');
const readlineSync = require('readline-sync');
const { options } = require('yargs');
var functionMeta = { lashHash256: null }
const opName = `executeCLI`
const CGREEN = '\x1b[32m'
const CPROMPT = '\x1b[33m'
const CNOTIF = '\x1b[33m'
const CRESET = '\x1b[0m'
const CDONE = '\x1b[37m'

const getFunctionArn = function (functionName, locationFolder) {
    const outputFile = path.resolve(locationFolder, `${functionName}.json`)
    if (fs.existsSync(outputFile)) {
        const outputData = JSON.parse(fs.readFileSync(outputFile))
        return outputData.data.FunctionArn
    } else {
        return undefined
    }
}

const getErrorMessage = function (error) {
    return error.message ? error.message : JSON.stringify(error)
}

const deployStack = function (options) {
    const { configFile, envFile, envName, configStackFolder, configStackName, regionName } = options
    const envFilePath = path.resolve(envFile || '.env')
    if (fs.existsSync(envFilePath)) {
        require('dotenv').config({ path: envFilePath })
    }
    const envOptions = { DEPLOYMENT_ENV: envName, DEPLOYMENT_REGION: regionName }
    var config = simplify.getInputConfig(path.resolve(configFile || 'config.json'), envOptions)
    const stackConfigFile = path.resolve(config.OutputFolder, 'StackConfig.json')
    const stackYamlFile = path.resolve(configStackFolder, `${configStackName}`, `template.yaml`)
    if (!fs.existsSync(stackYamlFile)) {
        simplify.finishWithErrors(`${opName}-CheckTemplate`, `${stackYamlFile} not found.`)
    }
    config.FunctionName = `${process.env.FUNCTION_NAME}-${process.env.DEPLOYMENT_ENV}`
    const stackFullName = `${process.env.PROJECT_NAME || config.FunctionName}-${configStackName}-${process.env.DEPLOYMENT_ENV}`
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
                    outputData = { ...JSON.parse(fs.readFileSync(stackConfigFile)), ...outputData }
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
                            name: paramName,
                            type: docYaml.Parameters[paramName].Type
                        })
                    }
                })
                return { resultParameters, resultErrors, stackOutputData }
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
                    const { resultParameters, stackOutputData } = mappingParameters(docYaml, parameters)
                    stackPluginModule.preCreation({ simplify, provider, config }, configStackName, resultParameters, docYaml, stackOutputData).then(parameterResult => {
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
    const { configFile, envFile, envName, configStackFolder, configStackName, regionName } = options
    const envFilePath = path.resolve(envFile || '.env')
    if (fs.existsSync(envFilePath)) {
        require('dotenv').config({ path: envFilePath })
    }
    const envOptions = { DEPLOYMENT_ENV: envName, DEPLOYMENT_REGION: regionName }
    var config = simplify.getInputConfig(path.resolve(configFile || 'config.json'), envOptions)
    const stackConfigFile = path.resolve(config.OutputFolder, 'StackConfig.json')
    const stackList = fs.existsSync(stackConfigFile) ? JSON.parse(fs.readFileSync(stackConfigFile)) : {}
    provider.setConfig(config).then(function () {
        function deleteStack(stackName, stackPluginModule) {
            const stackFullName = `${process.env.PROJECT_NAME || config.FunctionName}-${stackName}-${process.env.DEPLOYMENT_ENV}`
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
                        simplify.consoleWithMessage(`${opName}-${stackName}`, `${stackConfigFile} - (Changed)`)
                    }).catch(function (error) {
                        simplify.finishWithErrors(`${opName}-CleanupResource:`, getErrorMessage(error))
                    })
                } else {
                    delete stackList[stackName]
                    fs.writeFileSync(stackConfigFile, JSON.stringify(stackList, null, 4))
                    simplify.consoleWithMessage(`${opName}-PostCleanup`, `${path.resolve(configStackFolder, `${stackName}.js`)} - (Skipped)`)
                    simplify.consoleWithMessage(`${opName}-${stackName}`, `${stackConfigFile} - (Changed)`)
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
                if (stackList[stackName].StackId) {
                    deleteByStackName(stackName)
                }
            })
        } else {
            deleteByStackName(configStackName)
        }
    }).catch(function (error) {
        simplify.finishWithErrors(`${opName}-LoadCredentials`, getErrorMessage(error))
    })
}

const deployFunction = function (options) {
    const { regionName, functionName, envName, configFile, envFile, roleFile, policyFile, sourceDir, forceUpdate, asFunctionLayer, publishNewVersion } = options
    const envFilePath = path.resolve(envFile || '.env')
    if (fs.existsSync(envFilePath)) {
        require('dotenv').config({ path: envFilePath })
    }
    const envOptions = { FUNCTION_NAME: functionName, DEPLOYMENT_ENV: envName, DEPLOYMENT_REGION: regionName }
    var config = simplify.getInputConfig(path.resolve(configFile || 'config.json'), envOptions)
    const stackConfigFile = path.resolve(config.OutputFolder, 'StackConfig.json')
    var policyDocument = simplify.getContentFile(path.resolve(policyFile || 'policy.json'), envOptions)
    var assumeRoleDocument = simplify.getContentFile(path.resolve(roleFile || 'role.json'), envOptions)
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
        const writeStackOutput = function (config, data) {
            let outputData = {}
            const functionRegion = data.FunctionArn.split(':')[3]
            outputData[functionName || process.env.FUNCTION_NAME] = { Region: functionRegion, FunctionName: config.Function.FunctionName, FunctionArn: data.FunctionArn }
            if (fs.existsSync(stackConfigFile)) {
                outputData = { ...JSON.parse(fs.readFileSync(stackConfigFile)), ...outputData }
            }
            const pathDirName = path.dirname(path.resolve(stackConfigFile))
            if (!fs.existsSync(pathDirName)) {
                fs.mkdirSync(pathDirName, { recursive: true })
            }
            fs.writeFileSync(stackConfigFile, JSON.stringify(outputData, null, 4))
        }
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
                        writeStackOutput(config, functionVersion)
                        functionMeta.data = functionVersion /** update versioned metadata */
                        fs.writeFileSync(path.resolve(config.OutputFolder, `${config.Function.FunctionName}.json`), JSON.stringify(functionMeta, null, 4))
                        fs.writeFileSync(path.resolve(config.OutputFolder, `${config.Function.FunctionName}.hash`), functionMeta.uploadInfor.FileSha256)
                        simplify.consoleWithMessage(`${opName}-PublishFunction`, `Done: ${functionVersion.FunctionArn}`)
                    }).catch(err => simplify.finishWithErrors(`${opName}-PublishFunction-ERROR`, err))
                } else {
                    writeStackOutput(config, data)
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
    function destroyFunctionByName(functionName, envName, regionName, stackList) {
        const envOptions = { FUNCTION_NAME: functionName, DEPLOYMENT_ENV: envName, DEPLOYMENT_REGION: regionName }
        var config = simplify.getInputConfig(path.resolve(configFile || 'config.json'), envOptions)
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
            }).then(data => {
                delete stackList[functionName || process.env.FUNCTION_NAME]
                fs.writeFileSync(stackConfigFile, JSON.stringify(stackList, null, 4))
                let configInput = JSON.parse(fs.readFileSync(path.resolve(configFile || 'config.json')))
                configInput.Function.Layers = []
                fs.writeFileSync(path.resolve(configFile || 'config.json'), JSON.stringify(configInput, null, 4))
                fs.unlinkSync(path.resolve(config.OutputFolder, `${data.FunctionName}.hash`))
                fs.unlinkSync(path.resolve(config.OutputFolder, `${data.FunctionName}.json`))
                simplify.consoleWithMessage(`${opName}-DestroyFunction`, `Done. ${data.FunctionName}`)
                return Promise.resolve(data)
            })
        }).then(_ => {
            simplify.deleteDeploymentBucket({ adaptor: provider.getStorage(), bucketName: config.Bucket.Name }).then(function () {
                simplify.consoleWithMessage(`${opName}-DestroyBucket`, `Done. ${config.Bucket.Name}`)
            })
        }).catch(error => simplify.consoleWithMessage(`${opName}-DestroyFunction-ERROR`, getErrorMessage(error)))
    }
    const { regionName, configFile, envFile, envName, functionName, withFunctionLayer } = options
    const envFilePath = path.resolve(envFile || '.env')
    if (fs.existsSync(envFilePath)) {
        require('dotenv').config({ path: envFilePath })
    }
    const stackConfigFile = path.resolve(config.OutputFolder, 'StackConfig.json')
    const stackList = fs.existsSync(stackConfigFile) ? JSON.parse(fs.readFileSync(stackConfigFile)) : {}
    destroyFunctionByName(functionName, envName, regionName, stackList)
}

const listStacks = function (options) {
    const { regionName, configFile, envFile, envName } = options
    const envFilePath = path.resolve(envFile || '.env')
    if (fs.existsSync(envFilePath)) {
        require('dotenv').config({ path: envFilePath })
    }
    const envOptions = { DEPLOYMENT_ENV: envName, DEPLOYMENT_REGION: regionName }
    var config = simplify.getInputConfig(path.resolve(configFile || 'config.json'), envOptions)
    const stackConfigFile = path.resolve(config.OutputFolder, 'StackConfig.json')
    const stackList = fs.existsSync(stackConfigFile) ? JSON.parse(fs.readFileSync(stackConfigFile)) : {}
    let tableData = []
    if (Object.keys(stackList).length > 0) {
        console.log(`\n * Listing for ${CNOTIF}${envName || process.env.DEPLOYMENT_ENV}${CDONE} environment \n`)
        Object.keys(stackList).map((stackName, idx) => {
            tableData.push({
                Index: idx + 1,
                Name: stackName,
                Type: stackList[stackName].StackId ? "CF-Stack" : "Function",
                Region: stackList[stackName].Region,
                ResourceId: (stackList[stackName].StackId || stackList[stackName].FunctionArn).truncate(50),
                Status: "INSTALLED"
            })
        })
        utilities.printTableWithJSON(tableData)
    } else {
        console.log(`\n * Listing for ${CNOTIF}${envName || process.env.DEPLOYMENT_ENV}${CDONE} environment: (empty) \n`)
    }
}

const createStackOnInit = function (stackNameOrURL) {
    const writeTemplateOutput = (templateFolderName, projectLocation) => {
        const inputDirectory = path.join(__dirname, ...templateFolderName.split('/'), stackNameOrURL)
        if (fs.existsSync(inputDirectory)) {
            utilities.getFilesInDirectory(inputDirectory).then(function (files) {
                files.forEach(function (filePath) {
                    var outputFileName = filePath.replace(inputDirectory, `${projectLocation}`).replace(/^\/+/, '').replace(/^\\+/, '')
                    fs.readFile(filePath, function (err, data) {
                        if (err) reject(err)
                        else {
                            const pathDirName = path.dirname(path.resolve(outputFileName))
                            if (!fs.existsSync(pathDirName)) {
                                fs.mkdirSync(pathDirName, { recursive: true })
                            }
                            fs.writeFileSync(path.resolve(outputFileName.replace('dotenv', '.env')), fs.readFileSync(filePath))
                        }
                    })
                })
            }).catch(err => console.log("ERRR:", err))
        } else {
            return false
        }
    }
    if (stackNameOrURL.startsWith("https://")) {
        fetch(stackNameOrURL.replace("https://github.com/", "https://raw.githubusercontent.com/").replace("/blob/", "/")).then(response => response.text()).then(templateYAML => {
            const partialUris = stackNameOrURL.split('/').slice(-2)
            const projectLocation = partialUris.length > 1 ? partialUris[0] : argv.name || '.'
            var outputFileName = (`${projectLocation}/template.yaml`).replace(/^\/+/, '').replace(/^\\+/, '')
            const pathDirName = path.dirname(path.resolve(outputFileName))
            if (!fs.existsSync(pathDirName)) {
                fs.mkdirSync(pathDirName, { recursive: true })
            }
            fs.writeFileSync(path.resolve(outputFileName), templateYAML)
        }).catch(error => simplify.finishWithErrors(`${opName}-DownloadTemplate-ERROR`, getErrorMessage(error)))
    } else {
        writeTemplateOutput("template/functions", argv.name || stackNameOrURL)
        writeTemplateOutput("template/stacks", argv.name || stackNameOrURL)
        simplify.finishWithMessage(`Initialized`, `${path.resolve('.')}`)
    }
}

const printDeletingDialog = function (options) {
    const { regionName, configFile, envFile, envName } = options
    const envFilePath = path.resolve(envFile || '.env')
    if (fs.existsSync(envFilePath)) {
        require('dotenv').config({ path: envFilePath })
    }
    const envOptions = { DEPLOYMENT_ENV: envName, DEPLOYMENT_REGION: regionName }
    var config = simplify.getInputConfig(path.resolve(configFile || 'config.json'), envOptions)
    const stackConfigFile = path.resolve(config.OutputFolder, 'StackConfig.json')
    const stackList = fs.existsSync(stackConfigFile) ? JSON.parse(fs.readFileSync(stackConfigFile)) : {}
    let tableData = []
    if (Object.keys(stackList).length > 0) {
        console.log(`\n * Request deleting for ${CNOTIF}${envName || process.env.DEPLOYMENT_ENV}${CDONE} environment \n`)
        Object.keys(stackList).map((stackName, idx) => {
            tableData.push({
                Index: idx + 1,
                Name: stackName,
                Type: stackList[stackName].StackId ? "CF-Stack" : "Function",
                Region: stackList[stackName].Region,
                ResourceId: (stackList[stackName].StackId || stackList[stackName].FunctionArn).truncate(50),
                Status: (stackList[stackName].Region == config.Region) ? `DELETING` : `SKIPPED`
            })
        })
        utilities.printTableWithJSON(tableData)
    } else {
        console.log(`\n * Deleting request for ${CNOTIF}${envName || process.env.DEPLOYMENT_ENV}${CDONE} environment: (empty) \n`)
    }
    return tableData
}

var argv = require('yargs').usage('simplify-cli init | deploy | destroy [options]')
    .string('name').describe('name', 'Specify a name for the created project')
    .string('template').describe('template', 'Init nodejs or python template')
    .string('config').alias('c', 'config').describe('config', 'function configuration').default('config', 'config.json')
    .string('policy').alias('p', 'policy').describe('policy', 'function policy to attach').default('policy', 'policy.json')
    .string('role').alias('r', 'role').describe('role', 'function policy to attach').default('role', 'role.json')
    .string('source').alias('s', 'source').describe('source', 'function source to deploy').default('source', 'src')
    .string('env').alias('e', 'env').describe('env', 'environment name')
    .string('region').describe('region', 'region name to deploy')
    .string('env-file').describe('env-file', 'environment variable file').default('env-file', '.env')
    .boolean('update').describe('update', 'force update function code').default('update', false)
    .boolean('publish').describe('publish', 'force publish with a version').default('publish', false)
    .boolean('layer').describe('layer', 'deploy source folder as layer').default('layer', false)
    .string('location').describe('location', 'stack folder to deploy').default('location', '')
    .string('stack-name').describe('stack-name', 'stack name to deploy')
    .string('function').describe('function', 'function name to deploy')
    .string('composer').describe('composer', 'multistacks composer to deploy')
    .demandOption(['c', 'p', 's']).demandCommand(1).argv;

var cmdOPS = (argv._[0] || 'deploy').toUpperCase()
if (cmdOPS === "DEPLOY") {
    if (argv['stack-name'] !== undefined) {
        deployStack({
            regionName: argv.region,
            configFile: argv.config,
            envName: argv.env,
            envFile: argv['env-file'],
            configStackFolder: argv.location,
            configStackName: argv['stack-name']
        })
    } else {
        deployFunction({
            regionName: argv.region,
            functionName: argv.function,
            configFile: argv.config,
            envName: argv.env,
            envFile: argv['env-file'],
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
            regionName: argv.region,
            configFile: argv.config,
            envName: argv.env,
            envFile: argv['env-file'],
            configStackFolder: argv.location,
            configStackName: argv['stack-name']
        })
    } else if (argv['function'] !== undefined) {
        destroyFunction({
            regionName: argv.region,
            configFile: argv.config,
            envName: argv.env,
            envFile: argv['env-file'],
            functionName: argv.function,
            withFunctionLayer: argv.layer
        })
    } else {
        const deletedResources = printDeletingDialog({
            regionName: argv.region,
            configFile: argv.config,
            envName: argv.env,
            envFile: argv['env-file']
        })
        if (deletedResources.length && readlineSync.keyInYN(` - ${CPROMPT}Do you want to destroy the DELETING resources?${CRESET} `)) {
            deletedResources.map(resource => {
                if (resource.Type === "CF-Stack") {
                    destroyStack({
                        regionName: resource.Region,
                        configFile: argv.config,
                        envName: argv.env,
                        envFile: argv['env-file'],
                        configStackFolder: argv.location,
                        configStackName: resource.Name
                    })
                } else {
                    destroyFunction({
                        regionName: resource.Region,
                        configFile: argv.config,
                        envName: argv.env,
                        envFile: argv['env-file'],
                        functionName: resource.Name,
                        withFunctionLayer: true
                    })
                }
            })
        }
    }
} else if (cmdOPS === "INIT") {
    if (typeof argv.template === "undefined") {
        const getDirectories = source =>
            fs.readdirSync(source, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name)
        const showPrompt = (templateFolderName, promptDescription) => {
            console.log(promptDescription)
            getDirectories(path.join(__dirname, templateFolderName)).map((template, idx) => {
                const descFile = path.join(__dirname, templateFolderName, template, "description.txt")
                if (fs.existsSync(descFile)) {
                    console.log(` ${idx + 1}.`, `${CNOTIF}${template}${CRESET} - ${fs.readFileSync(descFile)}`)
                } else {
                    console.log(` ${idx + 1}.`, `${template} - No information found in description.txt.`)
                }
            })
        }

        showPrompt("template/functions", `\nCreate project environment: simplify-cli init --template=Default | NodeJS | Python\n`)
        showPrompt("template/stacks", `\nCreate associated CF stack: simplify-cli init --template=CloudFront | CognitoUser...\n`)
        console.log(`\n *`, `Or install from URL: simplify-cli init --template=https://github.com/awslabs/...template.yml \n`)
    } else {
        createStackOnInit(argv.template)
    }
} else if (cmdOPS === "LIST") {
    listStacks({
        configFile: argv.config,
        envName: argv.env,
        envFile: argv['env-file'],
    })
}

module.exports = {
    deployFunction,
    destroyFunction,
    deployStack,
    destroyStack
}
