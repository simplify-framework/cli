#!/usr/bin/env node
'use strict';
global.crypto = require('crypto')
const path = require('path')
const fs = require('fs')
const fetch = require('node-fetch')
const { yamlParse } = require('yaml-cfn');
process.env.DISABLE_BOX_BANNER = true
const simplify = require('simplify-sdk')
const utilities = require('simplify-sdk/utilities')
const provider = require('simplify-sdk/provider');
const readlineSync = require('readline-sync');
const { options } = require('yargs');
const { exec } = require('child_process');
const { authenticate, registerUser, confirmRegistration, getCurrentSession, userSignOut } = require('./cognito')
const PLAN_DEFINITIONS = {
    "BASIC": {
        "Index": 0,
        "Version": "Community",
        "Description": "FREE membership with community access to development resources",
        "Subscription": 0
    },
    "PREMIUM": {
        "Index": 1,
        "Version": "Enterprise",
        "Description": "10$ per month with unlimited access to productionr ready resources",
        "Subscription": 10
    }
}
var currentSubscription = "Basic"
var functionMeta = { lashHash256: null }
const opName = `executeCLI`
const CERROR = '\x1b[31m'
const CGREEN = '\x1b[32m'
const CPROMPT = '\x1b[33m'
const CNOTIF = '\x1b[33m'
const CRESET = '\x1b[0m'
const CDONE = '\x1b[37m'
const CBRIGHT = '\x1b[37m'
const CUNDERLINE = '\x1b[4m'
const COLORS = function (name) {
    const colorCodes = ["\x1b[31m", "\x1b[32m", "\x1b[33m", "\x1b[34m", "\x1b[35m", "\x1b[36m", "\x1b[31m", "\x1b[32m", "\x1b[33m", "\x1b[34m", "\x1b[35m", "\x1b[36m", "\x1b[31m", "\x1b[32m", "\x1b[33m", "\x1b[34m", "\x1b[35m", "\x1b[36m", "\x1b[31m", "\x1b[32m", "\x1b[33m", "\x1b[34m", "\x1b[35m", "\x1b[36m", "\x1b[31m", "\x1b[32m", "\x1b[33m", "\x1b[34m", "\x1b[35m", "\x1b[36m"]
    return colorCodes[(name.toUpperCase().charCodeAt(0) - 65) % colorCodes.length]
}
const envFilePath = path.resolve('.env')
if (fs.existsSync(envFilePath)) {
    require('dotenv').config({ path: envFilePath })
}

const showBoxBanner = function () {
    console.log("╓───────────────────────────────────────────────────────────────╖")
    console.log(`║                 Simplify CLI - Version ${require('./package.json').version}                 ║`)
    console.log("╙───────────────────────────────────────────────────────────────╜")
}

const getFunctionArn = function (functionName, locationFolder) {
    const outputFile = path.resolve(locationFolder, `StackConfig.json`)
    if (fs.existsSync(outputFile)) {
        const outputData = JSON.parse(fs.readFileSync(outputFile))
        return outputData[functionName].FunctionArn
    } else {
        return undefined
    }
}

const getErrorMessage = function (error) {
    return error.message ? error.message : JSON.stringify(error)
}

const deployStack = function (options) {
    const { configFile, envFile, dataFile, envName, configStackFolder, configStackName, regionName } = options
    const envFilePath = path.resolve(envFile || '.env')
    if (fs.existsSync(envFilePath)) {
        require('dotenv').config({ path: envFilePath })
    }
    const envOptions = { DEPLOYMENT_ENV: envName, DEPLOYMENT_REGION: regionName }
    var config = simplify.getInputConfig(path.resolve(configFile || 'config.json'), envOptions)
    const stackConfigFile = path.resolve(config.OutputFolder, envName || process.env.DEPLOYMENT_ENV, 'StackConfig.json')
    const stackYamlFile = path.resolve(configStackFolder, `${configStackName}`, `template.yaml`)
    if (!fs.existsSync(stackYamlFile)) {
        simplify.finishWithErrors(`${opName}-CheckTemplate`, `${stackYamlFile} not found.`)
    }
    config.FunctionName = `${process.env.FUNCTION_NAME}-${process.env.DEPLOYMENT_ENV}`
    const stackFullName = `${process.env.PROJECT_NAME || config.FunctionName}-${configStackName}-${process.env.DEPLOYMENT_ENV}`
    const stackExtension = path.resolve(configStackFolder, configStackName, `extension`)
    provider.setConfig(config).then(function () {
        simplify.uploadLocalFile({
            adaptor: provider.getStorage(),
            ...{ bucketKey: config.Bucket.Key, inputLocalFile: stackYamlFile }
        }).then(function (uploadInfo) {
            function processStackData(stackData) {
                let outputData = {}
                outputData[configStackName] = { "LastUpdate": Date.now(), "Type": "CF-Stack" }
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
                            ...parameters
                        },
                        stackTemplate: stackTemplate
                    }
                }).then(function (stackData) {
                    if (stackPluginModule && typeof stackPluginModule.postCreation === 'function') {
                        stackPluginModule.postCreation({ simplify, provider, config }, configStackName, stackData).then(result => processStackData(result))
                        simplify.consoleWithMessage(`${opName}-PostCreation`, `${stackExtension + '.js'} - (Executed)`)
                    } else {
                        simplify.consoleWithMessage(`${opName}-PostCreation`, `${stackExtension + '.js'} - (Skipped)`)
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
                    Object.keys(stackOutputData).map(stackName => {
                        Object.keys(stackOutputData[stackName]).map(param => {
                            if (["LastUpdate", "Type"].indexOf(param) == -1) {
                                stackParamteres[`${stackName}.${CUNDERLINE}${param}${CRESET}`] = stackOutputData[stackName][param]
                            }
                        })
                    })
                }
                Object.keys(docYaml.Parameters).map(paramName => {
                    function getSimilarParameter(stackParamteres, paramName) {
                        let foundParam = stackParamteres[Object.keys(stackParamteres).find(x => paramName == x.replace(/\x1b\[[0-9;]*m/g, "").replace(/[\W_]/g, ''))]
                        return foundParam || stackParamteres[Object.keys(stackParamteres).find(x => paramName.indexOf(x.split('.')[1].replace(/\x1b\[[0-9;]*m/g, "")) >= 0)]
                    }
                    resultParameters[paramName] = parameters[paramName] || getSimilarParameter(stackParamteres, paramName)
                    if (!resultParameters[paramName]) {
                        if (!resultErrors) resultErrors = []
                        resultErrors.push({
                            name: paramName,
                            type: docYaml.Parameters[paramName].Type
                        })
                    }
                })
                return { resultParameters, resultErrors, stackOutputData, stackParamteres }
            }

            function selectParameter(param, docYaml, resultParameters, stackParamteres) {
                const descParam = docYaml.Parameters[param].Description
                const allowedValues = docYaml.Parameters[param].AllowedValues
                const options = Object.keys(stackParamteres).map(x => `${x} = ${stackParamteres[x]}`)
                const index = readlineSync.keyInSelect(allowedValues || options, `Select a value for ${CPROMPT}${param}${CRESET} parameter (${descParam || ''}) ?`, { 
                    cancel: allowedValues ? `${CBRIGHT}None${CRESET} - (No change)` : `${CBRIGHT}Manual enter a value${CRESET} - (Continue)`
                })
                if (index >= 0) {
                    resultParameters[param] = stackParamteres[Object.keys(stackParamteres)[index]]
                } else if (!allowedValues) {
                    resultParameters[param] = readlineSync.question(`\n * Enter parameter value for ${CPROMPT}${param}${CRESET} (${docYaml.Parameters[param].Default || ''}) :`) || docYaml.Parameters[param].Default
                }
            }

            function reviewParameters(resultParameters, stackParamteres, docYaml) {
                let redoParamIndex = -1
                do {
                    const reviewOptions = Object.keys(resultParameters).map(x => `${x} = ${resultParameters[x] || '(not set)'}`)
                    redoParamIndex = readlineSync.keyInSelect(reviewOptions, `Do you want to change any of those parameters?`, { cancel: `${CBRIGHT}Continue to deploy${CRESET} - (No change)` })
                    if (redoParamIndex !== -1) {
                        selectParameter(Object.keys(resultParameters)[redoParamIndex], docYaml, resultParameters, stackParamteres)
                    }
                } while (redoParamIndex !== -1)
            }

            function saveParameters(resultParameters) {
                fs.writeFileSync(path.resolve(configStackFolder, configStackName, dataFile), JSON.stringify(resultParameters, null, 4))
            }

            function processParameters(resultErrors, resultParameters, stackParamteres, docYaml) {
                if (!resultErrors) {
                    reviewParameters(resultParameters, stackParamteres, docYaml)
                    saveParameters(resultParameters)
                    createStack(templateURL, resultParameters, stackPluginModule)
                } else {
                    resultErrors.map(error => {
                        selectParameter(error.name, docYaml, resultParameters, stackParamteres)
                    })
                    reviewParameters(resultParameters, stackParamteres, docYaml)
                    const finalResult = mappingParameters(docYaml, resultParameters)
                    if (!finalResult.resultErrors) {
                        saveParameters(resultParameters)
                        createStack(templateURL, finalResult.resultParameters, stackPluginModule)
                    } else {
                        finalResult.resultErrors.map(error => {
                            const adjustParameter = error.name
                            simplify.consoleWithErrors(`${opName}-Verification`, `(${stackFullName}) name=${adjustParameter} type=${error.type} is not set.`)
                            finalResult.resultParameters[adjustParameter] = readlineSync.question(`\n * Enter parameter value for ${CPROMPT}${adjustParameter}${CRESET} :`)
                        })
                        saveParameters(finalResult.resultParameters)
                        createStack(templateURL, finalResult.resultParameters, stackPluginModule)
                    }
                }
            }

            var templateURL = uploadInfo.Location
            try {
                const docYaml = yamlParse(fs.readFileSync(stackYamlFile));
                var parameters = {
                    Environment: process.env.DEPLOYMENT_ENV
                }
                if (fs.existsSync(path.resolve(configStackFolder, configStackName, dataFile))) {
                    parameters = { ...parameters, ...JSON.parse(fs.readFileSync(path.resolve(configStackFolder, configStackName, dataFile))) }
                }
                var stackPluginModule = {}
                if (fs.existsSync(stackExtension + '.js')) {
                    stackPluginModule = require(stackExtension)
                }
                if (typeof stackPluginModule.preCreation === 'function') {
                    const { resultParameters, stackOutputData, stackParamteres } = mappingParameters(docYaml, parameters)
                    stackPluginModule.preCreation({ simplify, provider, config }, configStackName, resultParameters, docYaml, stackOutputData).then(parameterResult => {
                        const { resultParameters, resultErrors } = mappingParameters(docYaml, parameterResult)
                        simplify.consoleWithMessage(`${opName}-PreCreation`, `${stackExtension + '.js'} - (Executed)`)
                        processParameters(resultErrors, resultParameters, stackParamteres, docYaml)
                    })
                } else {
                    simplify.consoleWithMessage(`${opName}-PreCreation`, `${stackExtension + '.js'} - (Skipped)`)
                    const { resultParameters, resultErrors, stackParamteres } = mappingParameters(docYaml, parameters)
                    processParameters(resultErrors, resultParameters, stackParamteres, docYaml)
                }
            } catch (error) {
                simplify.finishWithErrors(`${opName}-LoadYAMLResource:`, getErrorMessage(error))
            }
        })
    }).catch(error => simplify.finishWithErrors(`${opName}-LoadYAMLResource:`, getErrorMessage(error)))
}

const destroyStack = function (options) {
    const { configFile, envFile, envName, configStackFolder, configStackName, regionName } = options
    const envFilePath = path.resolve(envFile || '.env')
    if (fs.existsSync(envFilePath)) {
        require('dotenv').config({ path: envFilePath })
    }
    const envOptions = { DEPLOYMENT_ENV: envName, DEPLOYMENT_REGION: regionName }
    var config = simplify.getInputConfig(path.resolve(configFile || 'config.json'), envOptions)
    const stackConfigFile = path.resolve(config.OutputFolder, envName || process.env.DEPLOYMENT_ENV, 'StackConfig.json')
    const stackList = fs.existsSync(stackConfigFile) ? JSON.parse(fs.readFileSync(stackConfigFile)) : {}
    provider.setConfig(config).then(function () {
        function deleteStack(stackName, stackPluginModule) {
            const stackExtension = path.resolve(configStackFolder, stackName, `extension`)
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
                        simplify.consoleWithMessage(`${opName}-PostCleanup`, `${stackExtension + '.js'} - (Executed)`)
                        simplify.consoleWithMessage(`${opName}-${stackName}`, `${stackConfigFile} - (Changed)`)
                    }).catch(function (error) {
                        simplify.finishWithErrors(`${opName}-CleanupResource:`, getErrorMessage(error))
                    })
                } else {
                    delete stackList[stackName]
                    fs.writeFileSync(stackConfigFile, JSON.stringify(stackList, null, 4))
                    simplify.consoleWithMessage(`${opName}-PostCleanup`, `${stackExtension + '.js'} - (Skipped)`)
                    simplify.consoleWithMessage(`${opName}-${stackName}`, `${stackConfigFile} - (Changed)`)
                }
            }).catch(function (error) {
                simplify.finishWithErrors(`${opName}-CleanupResource:`, getErrorMessage(error))
            })
        }
        function deleteByStackName(stackName) {
            var stackPluginModule = {}
            const stackExtension = path.resolve(configStackFolder, stackName, `extension`)
            if (fs.existsSync(stackExtension + '.js')) {
                stackPluginModule = require(stackExtension)
            }
            if (stackPluginModule && typeof stackPluginModule.preCleanup === 'function') {
                stackPluginModule.preCleanup({ simplify, provider, config }, stackName, stackList).then(stackName => {
                    simplify.consoleWithMessage(`${opName}-PreCleanup`, `${stackExtension + '.js'} - (Executed)`)
                    deleteStack(stackName, stackPluginModule)
                }).catch(function (error) {
                    simplify.finishWithErrors(`${opName}-PreCleanup`, getErrorMessage(error))
                })
            } else {
                simplify.consoleWithMessage(`${opName}-PreCleanup`, `${stackExtension + '.js'} - (Skipped)`)
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
    const envFilePath = path.resolve(functionName ? functionName : '', envFile || '.env')
    if (fs.existsSync(envFilePath)) {
        require('dotenv').config({ path: envFilePath })
    }
    const envOptions = { FUNCTION_NAME: functionName, DEPLOYMENT_ENV: envName, DEPLOYMENT_REGION: regionName }
    var config = simplify.getInputConfig(path.resolve(functionName ? functionName : '', configFile || 'config.json'), envOptions)
    const stackConfigFile = path.resolve(config.OutputFolder, envName || process.env.DEPLOYMENT_ENV, 'StackConfig.json')
    var policyDocument = simplify.getContentFile(path.resolve(functionName ? functionName : '', policyFile || 'policy.json'), envOptions)
    var assumeRoleDocument = simplify.getContentFile(path.resolve(functionName ? functionName : '', roleFile || 'role.json'), envOptions)
    if (!fs.existsSync(path.resolve(config.OutputFolder))) {
        fs.mkdirSync(path.resolve(config.OutputFolder), { recursive: true })
    }
    const outputFunctionFilePath = path.resolve(config.OutputFolder, `${envName || process.env.DEPLOYMENT_ENV}`, `${functionName || process.env.FUNCTION_NAME}.json`)
    const hashFunctionFilePath = path.resolve(config.OutputFolder, `${envName || process.env.DEPLOYMENT_ENV}`, `${functionName || process.env.FUNCTION_NAME}.hash`)
    if (fs.existsSync(hashFunctionFilePath)) {
        functionMeta.lashHash256 = fs.readFileSync(hashFunctionFilePath).toString()
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
                inputDirectory: path.resolve(functionName ? functionName : '', sourceDir || 'src'),
                outputFilePath: path.resolve(functionName ? functionName : '', 'dist'),
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
            outputData[functionName || process.env.FUNCTION_NAME] = {
                LastUpdate: Date.now(),
                Region: functionRegion,
                FunctionName: config.Function.FunctionName,
                FunctionArn: data.FunctionArn,
                Type: "Function"
            }
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
                        fs.writeFileSync(outputFunctionFilePath, JSON.stringify(functionMeta, null, 4))
                        fs.writeFileSync(hashFunctionFilePath, functionMeta.uploadInfor.FileSha256)
                        simplify.consoleWithMessage(`${opName}-PublishFunction`, `Done: ${functionVersion.FunctionArn}`)
                    }).catch(err => simplify.finishWithErrors(`${opName}-PublishFunction-ERROR`, err))
                } else {
                    writeStackOutput(config, data)
                    fs.writeFileSync(outputFunctionFilePath, JSON.stringify(functionMeta, null, 4))
                    fs.writeFileSync(hashFunctionFilePath, functionMeta.uploadInfor.FileSha256)
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
    const { regionName, functionName, envName, configFile, envFile, withFunctionLayer } = options
    const envFilePath = path.resolve(functionName ? functionName : '', envFile || '.env')
    if (fs.existsSync(envFilePath)) {
        require('dotenv').config({ path: envFilePath })
    }
    const envOptions = { FUNCTION_NAME: functionName, DEPLOYMENT_ENV: envName, DEPLOYMENT_REGION: regionName }
    var config = simplify.getInputConfig(path.resolve(functionName ? functionName : '', configFile || 'config.json'), envOptions)
    const stackConfigFile = path.resolve(config.OutputFolder, envName || process.env.DEPLOYMENT_ENV, 'StackConfig.json')
    const outputFunctionFilePath = path.resolve(config.OutputFolder, `${envName || process.env.DEPLOYMENT_ENV}`, `${functionName || process.env.FUNCTION_NAME}.json`)
    const hashFunctionFilePath = path.resolve(config.OutputFolder, `${envName || process.env.DEPLOYMENT_ENV}`, `${functionName || process.env.FUNCTION_NAME}.hash`)
    const stackList = fs.existsSync(stackConfigFile) ? JSON.parse(fs.readFileSync(stackConfigFile)) : {}
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
            let configInput = JSON.parse(fs.readFileSync(path.resolve(functionName ? functionName : '', configFile || 'config.json')))
            configInput.Function.Layers = []
            fs.writeFileSync(path.resolve(functionName ? functionName : '', configFile || 'config.json'), JSON.stringify(configInput, null, 4))
            fs.unlinkSync(hashFunctionFilePath)
            fs.unlinkSync(outputFunctionFilePath)
            simplify.consoleWithMessage(`${opName}-DestroyFunction`, `Done. ${data.FunctionName}`)
        })
    }).then(data => {
        return simplify.deleteDeploymentBucket({ adaptor: provider.getStorage(), bucketName: config.Bucket.Name }).then(function () {
            simplify.consoleWithMessage(`${opName}-DestroyBucket`, `Done. ${config.Bucket.Name}`)
        })
    }).catch(error => simplify.consoleWithMessage(`${opName}-DestroyFunction-ERROR`, getErrorMessage(error)))
}

const createStackOnInit = function (stackNameOrURL, locationFolder, envArgs) {
    const writeTemplateOutput = (templateFolderName, projectLocation) => {
        const inputDirectory = path.join(__dirname, ...templateFolderName.split('/'), typeof stackNameOrURL === 'string' ? stackNameOrURL : '')
        if (fs.existsSync(inputDirectory)) {
            utilities.getFilesInDirectory(inputDirectory).then(function (files) {
                files.forEach(function (filePath) {
                    var outputFileName = filePath.replace(inputDirectory, `${projectLocation}`).replace(/^projects\//, '').replace(/^\/+/, '').replace(/^\\+/, '')
                    fs.readFile(filePath, function (err, data) {
                        if (err) reject(err)
                        else {
                            const pathDirName = path.dirname(path.resolve(locationFolder, outputFileName))
                            if (!fs.existsSync(pathDirName)) {
                                fs.mkdirSync(pathDirName, { recursive: true })
                            }
                            let dataReadBuffer = fs.readFileSync(filePath).toString('utf8')
                            if (outputFileName.endsWith('dotenv') || outputFileName.endsWith('package.json')) {
                                const parserArgs = typeof stackNameOrURL === 'object' ? stackNameOrURL : envArgs || {}
                                Object.keys(parserArgs).map(k => {
                                    const regExVar = new RegExp(`##${k}##`, 'g')
                                    dataReadBuffer = dataReadBuffer.replace(regExVar, parserArgs[k])
                                })
                            }
                            fs.writeFileSync(path.resolve(locationFolder, outputFileName.replace('dotenv', '.env')), dataReadBuffer)
                        }
                    })
                })
            }).catch(err => console.log("ERRR:", err))
        } else {
            return false
        }
    }
    if (typeof stackNameOrURL === 'string') {
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
                console.log(`\n * The ${projectLocation} stack has created successfully. Try simplify-cli deploy ${projectLocation}\n`)
            }).catch(error => simplify.finishWithErrors(`${opName}-DownloadTemplate-ERROR`, getErrorMessage(error)))
        } else {
            writeTemplateOutput("basic/functions", argv.name || stackNameOrURL)
            writeTemplateOutput("basic/stacks", argv.name || stackNameOrURL)
            console.log(`\n - The ${CGREEN}${argv.name || stackNameOrURL}${CRESET} stack has created successfully. Try simplify-cli deploy ${argv.name || stackNameOrURL}\n`)
        }
    } else {
        writeTemplateOutput("basic/projects", "")
    }
}

const printListingDialog = function (options, prompt) {
    const { regionName, configFile, envFile, envName } = options
    const envFilePath = path.resolve(envFile || '.env')
    if (fs.existsSync(envFilePath)) {
        require('dotenv').config({ path: envFilePath })
    }
    const envOptions = { DEPLOYMENT_ENV: envName, DEPLOYMENT_REGION: regionName }
    var config = simplify.getInputConfig(path.resolve(configFile || 'config.json'), envOptions)
    const stackConfigFile = path.resolve(config.OutputFolder, envName || process.env.DEPLOYMENT_ENV, 'StackConfig.json')
    const stackList = fs.existsSync(stackConfigFile) ? JSON.parse(fs.readFileSync(stackConfigFile)) : {}
    let tableData = []
    if (Object.keys(stackList).length > 0) {
        console.log(`\n - ${prompt ? prompt : `Listing installed components for ${CNOTIF}${envName || process.env.DEPLOYMENT_ENV}${CDONE} environment \n`}`)
        Object.keys(stackList).map((stackName, idx) => {
            tableData.push({
                Index: idx + 1,
                Name: stackName,
                Type: stackList[stackName].StackId ? "CF-Stack" : "Function",
                Region: stackList[stackName].Region,
                ResourceId: (stackList[stackName].StackId || stackList[stackName].FunctionArn).truncate(30),
                Status: "INSTALLED",
                LastUpdate: utilities.formatTimeSinceAgo(stackList[stackName].LastUpdate || Date.now())
            })
        })
        utilities.printTableWithJSON(tableData)
    } else {
        console.log(`\n - Listing installed components for ${CNOTIF}${envName || process.env.DEPLOYMENT_ENV}${CDONE} environment: (empty) \n`)
    }
    return tableData
}

const getDirectories = source =>
    fs.readdirSync(source, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name)

const showTemplates = (templateFolderName, promptDescription) => {
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

const showAvailableStacks = (options, promptDescription) => {
    const { regionName, configFile, envFile, envName } = options
    const envFilePath = path.resolve(envFile || '.env')
    if (fs.existsSync(envFilePath)) {
        require('dotenv').config({ path: envFilePath })
    }
    const envOptions = { DEPLOYMENT_ENV: envName, DEPLOYMENT_REGION: regionName }
    var config = simplify.getInputConfig(path.resolve(configFile || 'config.json'), envOptions)
    const stackConfigFile = path.resolve(config.OutputFolder, envName || process.env.DEPLOYMENT_ENV, 'StackConfig.json')
    const stackList = fs.existsSync(stackConfigFile) ? JSON.parse(fs.readFileSync(stackConfigFile)) : {}
    let stackStatus = "AVAILABLE"
    let stackUpdate = "         "
    let stackType = ""
    let indexOfTemplate = 0
    let tableStackData = []
    console.log(`\n - ${promptDescription}\n`)
    getDirectories(path.resolve('.')).map((template) => {
        const excludeFolders = [".simplify", ".git", ".github", "dist", "node_modules", "output"].indexOf(template) == -1 ? false : true
        if (!excludeFolders && !template.startsWith('.') && !template.startsWith('_')) {
            const descFile = path.resolve('.', template, "description.txt")
            const hasTemplateFile = fs.existsSync(path.resolve(template, "template.yaml"))
            let description = `No information found in description.txt. This may not be a compatible package.`
            const installedStack = Object.keys(stackList).indexOf(template) >= 0 ? true : false
            if (fs.existsSync(descFile)) {
                description = `${fs.readFileSync(descFile)}`
                stackStatus = installedStack ? "INSTALLED" : "AVAILABLE"
                stackUpdate = installedStack ? utilities.formatTimeSinceAgo(stackList[template].LastUpdate) : ""
                stackType = installedStack ? stackList[template].Type : hasTemplateFile ? "CF-Stack" : "Function"
            } else {
                stackStatus = "----*----"
                stackUpdate = "         "
                stackType = hasTemplateFile ? "CF-Stack" : "Unknown"
            }
            tableStackData.push({
                Index: `${indexOfTemplate + 1}`,
                Name: `${template}`,
                Type: stackType,
                Description: `${description.replace(/(\r\n|\n|\r)/gm, "").trim().truncate(30)}`,
                Status: stackStatus,
                LastUpdate: stackUpdate
            })
            indexOfTemplate++
        }
    })
    utilities.printTableWithJSON(tableStackData)
}

showBoxBanner()

var argv = require('yargs').usage('simplify-cli init | register | login | logout | upgrade | create | deploy | destroy | list [options]')
    .string('help').describe('help', 'Display Help for a specific command')
    .string('name').describe('name', 'Specify a name for the created project')
    .string('template').describe('template', 'Init nodejs or python template')
    .string('data').describe('data', 'Saved parameters in JSON file').default('data', 'parameters.json')
    .string('config').alias('c', 'config').describe('config', 'function configuration').default('config', 'config.json')
    .string('policy').alias('p', 'policy').describe('policy', 'function policy to attach').default('policy', 'policy.json')
    .string('role').alias('r', 'role').describe('role', 'function policy to attach').default('role', 'role.json')
    .string('source').alias('s', 'source').describe('source', 'function source to deploy').default('source', 'src')
    .string('env').alias('e', 'env').describe('env', 'environment name')
    .string('region').describe('region', 'region name to deploy')
    .string('exclude').describe('exclude', 'files or folders to exclude for a zip')
    .string('env-file').describe('env-file', 'environment variable file').default('env-file', '.env')
    .boolean('update').describe('update', 'force update function code').default('update', false)
    .boolean('publish').describe('publish', 'force publish with a version').default('publish', false)
    .boolean('layer').describe('layer', 'deploy source folder as layer').default('layer', false)
    .string('location').describe('location', 'stack folder to deploy').default('location', '')
    .string('stack').describe('stack', 'stack name to deploy')
    .string('function').describe('function', 'function name to deploy')
    .string('composer').describe('composer', 'multistacks composer to deploy')
    .demandOption(['c', 'p', 's']).demandCommand(1).argv;

var cmdOPS = (argv._[0] || 'list').toUpperCase()
var optCMD = (argv._.length > 1 ? argv._[1] : undefined)
var cmdArg = argv['stack'] || argv['function'] || optCMD
var cmdType = cmdArg ? fs.existsSync(path.resolve(argv.location, cmdArg, "template.yaml")) ? "CF-Stack" : "Function" : undefined

const showSubscriptionPlan = function (userSession) {
    currentSubscription = (userSession.getIdToken().payload[`subscription`] || 'Basic')
    const currentVersion = PLAN_DEFINITIONS[currentSubscription.toUpperCase()].Version || 'Community'
    console.log(`\n`, ` * ${CPROMPT}Welcome back${CRESET} : ${userSession.getIdToken().payload[`name`]}`)
    console.log(`  * ${CPROMPT}Subscription${CRESET} : ${CDONE}${currentSubscription}${CRESET} Plan (${currentVersion} Version)`)
    console.log(`  * ${CPROMPT}Upgrade plan${CRESET} : simplify-cli upgrade`)
}

const processCLI = function (cmdRun, session) {
    if (cmdRun === "DEPLOY") {
        if (cmdArg !== undefined) {
            (cmdType === "Function" ? deployFunction : deployStack)({
                regionName: argv.region,
                functionName: cmdArg,
                configFile: argv.config,
                configStackName: cmdArg,
                configStackFolder: argv.location,
                envName: argv.env,
                envFile: argv['env-file'],
                dataFile: argv.data,
                roleFile: argv.role,
                policyFile: argv.policy,
                sourceDir: argv.source,
                forceUpdate: argv.update,
                asFunctionLayer: argv.layer,
                publishNewVersion: argv.publish
            })
        } else {
            showAvailableStacks({
                regionName: argv.region,
                configFile: argv.config,
                envName: argv.env,
                envFile: argv['env-file']
            }, `Available ${CPROMPT}stack${CRESET} and ${CPROMPT}function${CRESET} to deploy with command: simplify-cli deploy [--stack or --function] name`)
        }

    } else if (cmdRun === "DESTROY") {
        if (cmdArg !== undefined) {
            (cmdType === "Function" ? destroyFunction({
                regionName: argv.region,
                configFile: argv.config,
                envName: argv.env,
                envFile: argv['env-file'],
                functionName: cmdArg,
                withFunctionLayer: argv.layer
            }) : destroyStack)({
                regionName: argv.region,
                configFile: argv.config,
                envName: argv.env,
                envFile: argv['env-file'],
                configStackFolder: argv.location,
                configStackName: cmdArg
            })
        } else {
            printListingDialog({
                regionName: argv.region,
                configFile: argv.config,
                envName: argv.env,
                envFile: argv['env-file']
            }, `Select a ${CPROMPT}stack${CRESET} or ${CPROMPT}function${CRESET} to destroy with command: simplify-cli destroy [--stack or --function] name`)
        }
    } else if (cmdRun === "LOGOUT") {
        userSignOut(session.getIdToken().payload['cognito:username'])
        console.log(`\n * Signed out, Your session has been wiped successfully. \n`)
    } else if (cmdRun === "LOGIN") {
        const username = readlineSync.questionEMail(` - ${CPROMPT}Your identity${CRESET} : `, { limitMessage: " * Your login email is invalid." })
        const password = readlineSync.question(` - ${CPROMPT}Your password${CRESET} : `, { hideEchoBack: true })
        authenticate(username, password).then(function (userSession) {
            showSubscriptionPlan(userSession)
        }).catch(error => console.error(error))
    } else if (cmdRun === "UPGRADE") {
        const subscriptionPlan = readlineSync.keyInSelect([
            `BASIC - ${PLAN_DEFINITIONS["BASIC"].Description}.`,
            `PREMIUM - ${PLAN_DEFINITIONS["PREMIUM"].Description}.`],
            ` - You are about to change your subscription from ${CPROMPT}${currentSubscription.toUpperCase()}${CRESET} plan to: `,
            { cancel: `SKIP - Retain my current subscription as the ${currentSubscription.toUpperCase()} one.` })
        if (subscriptionPlan >= 0) {
            const newSubscription = Object.keys(PLAN_DEFINITIONS).find(x => PLAN_DEFINITIONS[x].Index == (subscriptionPlan))
            console.log(`\n * You have selected to pay ${PLAN_DEFINITIONS[newSubscription].Subscription}$ for ${newSubscription} version!`)
            console.log(` * Unfortunately, this feature is not available at the moment. \n`)
        }
    } else if (cmdRun === "REGISTER") {
        const fullname = readlineSync.question(` - ${CPROMPT}What is your name${CRESET} : `, { limitMessage: " * Your name is invalid." })
        const username = readlineSync.questionEMail(` - ${CPROMPT}Registered email${CRESET} : `, { limitMessage: " * Your registered email is invalid." })
        const password = readlineSync.questionNewPassword(` - ${CPROMPT}New password${CRESET} : `, {
            hideEchoBack: true,
            charlist: '$<!-~>',
            min: 8, max: 24,
            confirmMessage: ` - ${CPROMPT}Confirm password${CRESET} : `
        })
        registerUser(fullname, username, password).then(function (user) {
            const activation = readlineSync.question(` - ${CPROMPT}Activation code${CRESET} : `, { hideEchoBack: false })
            confirmRegistration(user.username, activation).then(function (resultCode) {
                if (resultCode == 'SUCCESS') {
                    console.log(`${CPROMPT}Registration is done${CRESET}. Please login to continue.`)
                } else {
                    console.log(`${CPROMPT}Activation code is invalid${CRESET}. Please try again.`)
                    const activation = readlineSync.question(` - ${CPROMPT}Activation code${CRESET} : `, { hideEchoBack: false })
                    confirmRegistration(user.username, activation).then(function (resultCode) {
                        if (resultCode == 'SUCCESS') {
                            console.log(`${CPROMPT}Registration is done${CRESET}. Please login to continue.`)
                        } else {
                            console.log(`${CPROMPT}Activation code is invalid${CRESET}. Your account is not registered.`)
                        }
                    }).catch(error => console.error(error))
                }
            }).catch(error => console.error(error))
        }).catch(error => console.error(error))
    } else if (cmdRun === "LIST") {
        printListingDialog({
            regionName: argv.region,
            configFile: argv.config,
            envName: argv.env,
            envFile: argv['env-file']
        }, `Deployed ${CPROMPT}stacks${CRESET} and ${CPROMPT}functions${CRESET} managed by Simplify CLI:`)
    } else if (cmdRun === "INIT") {
        function verifyAccountAccess(options, callback, errorHandler) {
            const S3_OPTIONS = (options.DEPLOYMENT_REGION !== 'us-west-1' ? `--create-bucket-configuration LocationConstraint=${options.DEPLOYMENT_REGION} ` : '') + `--profile ${options.DEPLOYMENT_PROFILE} --region ${options.DEPLOYMENT_REGION}`
            exec(`aws s3api create-bucket --bucket ${options.DEPLOYMENT_BUCKET}-${options.DEPLOYMENT_REGION} ${S3_OPTIONS}`, (err, stdout, stderr) => {
                if (!err) {
                    if (stderr) {
                        errorHandler && errorHandler({ message: `The ${options.DEPLOYMENT_PROFILE} doesn't have s3:PutObject permission to ${options.DEPLOYMENT_BUCKET}-${options.DEPLOYMENT_REGION} bucket` })
                    } else {
                        callback && callback(options)
                    }
                } else {
                    errorHandler && errorHandler(err)
                }
            })
        }
        function setupAccountId(options, callback) {
            const REGIONS = ["us-east-2", "us-east-1", "us-west-1", "eu-west-1", "eu-central-1", "eu-west-3", "ap-northeast-1", "ap-southeast-2", "ap-southeast-1"]
            const regionIndex = readlineSync.keyInSelect([
                "us-east-2 (N. Virginia)", "us-east-1 (Ohio)", "us-west-1 (N. California)",
                "eu-west-1 (Ireland)", "eu-central-1 (Frankfurt)", "eu-west-3 (Paris)",
                "ap-northeast-1 (Tokyo)", "ap-southeast-2 (Sydney)", "ap-southeast-1 (Singapore)"
            ], ` - ${CPROMPT}Choose your AWS Region?${CRESET} `, { cancel: `${CBRIGHT}others${CRESET} (Enter manually)`})
            if (regionIndex == -1) {
                options.DEPLOYMENT_REGION = readlineSync.question(` - ${CPROMPT}What is your AWS Region?${CRESET} (${process.env.DEPLOYMENT_REGION || 'us-east-1'}) `) || `${process.env.DEPLOYMENT_REGION || 'us-east-1'}`
            } else {
                options.DEPLOYMENT_REGION = REGIONS[regionIndex]
                console.log(`\n *`, `Your have just selected the ${CBRIGHT}${options.DEPLOYMENT_REGION}${CRESET} region \n`)
            }
            exec(`aws sts get-caller-identity --profile ${options.DEPLOYMENT_PROFILE} --query "Account" --output=text`, (err, stdout, stderr) => {
                if (!err) {
                    options.DEPLOYMENT_ACCOUNT = readlineSync.question(` - ${CPROMPT}Confirm your AWS AccountId?${CRESET} (${stdout.trim()}) `) || `${stdout.trim()}`
                } else {
                    options.DEPLOYMENT_ACCOUNT = readlineSync.question(` - ${CPROMPT}What is your AWS AccountId?${CRESET} (${process.env.DEPLOYMENT_ACCOUNT || 'Enter a valid AccountId'}) `) || `${process.env.DEPLOYMENT_ACCOUNT || ''}`
                }
                verifyAccountAccess(options, callback, function(error) {
                    simplify.consoleWithErrors(`${opName}-INIT`, `${error}`)
                })
            })
        }
        function setupProfile(options, callback) {
            console.log(`\n See https://docs.aws.amazon.com/general/latest/gr/aws-sec-cred-types.html#access-keys-and-secret-access-keys \n`)
            options.DEPLOYMENT_PROFILE = readlineSync.question(` - ${CPROMPT}Choose a name for your AWS Profile${CRESET} (${process.env.PROJECT_NAME || 'default'}) `) || `${process.env.PROJECT_NAME || 'default'}`
            const awsAccessKeyID = readlineSync.question(` - ${CPROMPT}Enter your AWS Access KeyID${CRESET} :`)
            const awsSecretKey = readlineSync.question(` - ${CPROMPT}Enter your AWS Secreet Key${CRESET} :`, { hideEchoBack: true })
            const awsRoleARN = readlineSync.question(` - ${CPROMPT}Enter your Assume Role ARN${CRESET} (None):`)
            const awsRoleExtId = awsRoleARN ? readlineSync.question(` - ${CPROMPT}Enter your Assume Role External ID${CRESET} (None):`) : undefined
            exec(`aws configure set aws_access_key_id ${awsAccessKeyID} --profile ${options.DEPLOYMENT_PROFILE}`, (err, stdout, stderr) => {
                if (!err) {
                    exec(`aws configure set aws_secret_access_key ${awsSecretKey} --profile ${options.DEPLOYMENT_PROFILE}`, (err, stdout, stderr) => {
                        if (!err) {
                            console.log(`\n *`, `Your have just setup the ${CBRIGHT}${options.DEPLOYMENT_PROFILE}${CRESET} profile \n`)
                            if (awsRoleARN) {
                                exec(`aws configure set role_arn ${awsRoleARN} --profile ${options.DEPLOYMENT_PROFILE}`, (err, stdout, stderr) => {
                                    if (!err) {
                                        if (awsRoleExtId) {
                                            exec(`aws configure set external_id ${awsRoleExtId} --profile ${options.DEPLOYMENT_PROFILE}`, (err, stdout, stderr) => {
                                                if (!err) {
                                                    callback && callback(options)
                                                } else {
                                                    console.error(`${CERROR}${err}${CRESET}`)
                                                }
                                            })
                                        } else {
                                            callback && callback(options)
                                        }
                                    } else {
                                        console.error(`${CERROR}${err}${CRESET}`)
                                    }
                                })
                            } else {
                                callback && callback(options)
                            }
                        } else {
                            console.error(`${CERROR}${err}${CRESET}`)
                        }
                    })
                } else {
                    console.error(`${CERROR}${err}${CRESET}`)
                }
            })
        }
        exec(`aws --version`, (err, stdout, stderr) => {
            if (err) {
                console.log(`\n *`, `Missing awscli installed in your computer. Refer: https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html \n`)
            } else {
                let initOptions = {
                    PROJECT_NAME: readlineSync.question(` - ${CPROMPT}Choose a Project name?${CRESET} (${process.env.PROJECT_NAME || 'starwars'}) `) || `${process.env.PROJECT_NAME || 'starwars'}`,
                    DEPLOYMENT_BUCKET: readlineSync.question(` - ${CPROMPT}Choose an S3 Bucket name?${CRESET} (${process.env.DEPLOYMENT_BUCKET || 'starwars-0920'}) `) || `${process.env.DEPLOYMENT_BUCKET || 'starwars-0920'}`,
                    DEPLOYMENT_ENV: readlineSync.question(` - ${CPROMPT}Choose an Environment?${CRESET} (${process.env.DEPLOYMENT_ENV || 'demo'}) `) || `${process.env.DEPLOYMENT_ENV || 'demo'}`
                }
                exec('aws configure list-profiles', (err, stdout, stderr) => {
                    if (err) {
                        simplify.consoleWithErrors(`${opName}-INIT`, `${err}`)
                    } else {
                        const profileItems = stdout.split('\n').filter(x => x)
                        const selectedIndex = initOptions.DEPLOYMENT_PROFILE = readlineSync.keyInSelect(profileItems,
                            ` - ${CPROMPT}What is your AWS Profile?${CRESET}`,
                            { cancel: `I want to setup a new AWS Profile` })
                        if (selectedIndex == -1) {
                            setupProfile(initOptions, function(options) {
                                setupAccountId(options, function(options) {
                                    createStackOnInit(options, argv.location, process.env)
                                    console.log(`\n *`, `Type '--help' with CREATE to find more: simplify-cli create --help \n`)
                                })
                            })
                        } else {
                            initOptions.DEPLOYMENT_PROFILE = profileItems[selectedIndex]
                            console.log(`\n *`, `Your have just selected the ${CBRIGHT}${initOptions.DEPLOYMENT_PROFILE}${CRESET} profile \n`)
                            setupAccountId(initOptions, function(options) {
                                createStackOnInit(options, argv.location, process.env)
                                console.log(`\n *`, `Type '--help' with CREATE to find more: simplify-cli create --help \n`)
                            })
                        }
                    }
                });
            }
        })
    } else if (cmdRun === "CREATE") {
        const templateName = argv.template || optCMD
        if (typeof templateName === "undefined") {
            if (typeof argv.help !== "undefined") {
                showTemplates("basic/functions", `\nCreate a function template: simplify-cli create [--template=]ShowLog | Detector\n`)
                showTemplates("basic/stacks", `\nOr create a deployment stack: simplify-cli create [--template=]CloudFront | CognitoUser...\n`)
                console.log(`\n *`, `Or fetch from YAML: simplify-cli create [--template=]https://github.com/awslabs/...template.yml \n`)
            } else {
                console.log(`\n *`, `Missing a Template: simplify-cli create [--template=]Template \n`)
            }
        } else {
            createStackOnInit(templateName, argv.location, process.env)
        }
    } else {
        console.log(`\n * Command ${cmdRun} is not supported. Try with these commands: create | list | login | deploy | destroy \n`)
    }
}

if (["INIT", "LOGIN", "REGISTER"].indexOf(cmdOPS) == -1) {
    if (!fs.existsSync(path.resolve(argv.config || 'config.json'))) {
        console.log(`\n`, `- ${CPROMPT}This is not a valid environment${CRESET}. You must create an environment first.`)
        console.log(`\n`, `*`, `Create environment: \tsimplify-cli init`, `\n`)
    } else {
        getCurrentSession().then(session => {
            if (session && session.isValid()) {
                showSubscriptionPlan(session)
                processCLI(cmdOPS, session)
            } else {
                console.log(`${CPROMPT}Session is invalid${CRESET}. Please re-login.`)
                console.log(`\n *`, `Login: \tsimplify-cli login`)
            }
        }).catch(error => {
            console.log(`${CPROMPT}${error}${CRESET}. Please login or register an account.`)
            console.log(`\n *`, `Login: \tsimplify-cli login`)
            console.log(` *`, `Register: \tsimplify-cli register`, `\n`)
        })
    }
} else {
    if (["INIT"].indexOf(cmdOPS) == -1) {
        const configInfo = JSON.parse(fs.readFileSync(path.resolve(argv.config || 'config.json')))
        if (configInfo.hasOwnProperty('Profile') && configInfo.hasOwnProperty('Region') && configInfo.hasOwnProperty('Bucket')) {
            processCLI(cmdOPS)
        } else {
            console.log(`\n`, `- ${CPROMPT}This is not a valid environment${CRESET}. The ${argv.config || 'config.json'} is incorrect.`)
            console.log(`\n`, `*`, `Create environment: \tsimplify-cli init`, `\n`)
        }
    } else {
        processCLI("INIT")
    }
}

module.exports = {
    deployFunction,
    destroyFunction,
    deployStack,
    destroyStack
}
