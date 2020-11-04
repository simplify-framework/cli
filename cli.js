#!/usr/bin/env node
'use strict';
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
var functionMeta = { lashHash256: null }
const opName = `executeCLI`
const CGREEN = '\x1b[32m'
const CPROMPT = '\x1b[33m'
const CNOTIF = '\x1b[33m'
const CRESET = '\x1b[0m'
const CDONE = '\x1b[37m'
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
    const stackConfigFile = path.resolve(config.OutputFolder, 'StackConfig.json')
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
                let outputData = { }
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
                            Environment: `${process.env.DEPLOYMENT_ENV}`,
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
                    Environment: process.env.DEPLOYMENT_ENV
                }
                if (fs.existsSync(path.resolve(dataFile))) {
                    parameters = { ...parameters, ...JSON.parse(fs.readFileSync(path.resolve(dataFile))) }
                }
                var stackPluginModule = {}
                if (fs.existsSync(stackExtension + '.js')) {
                    stackPluginModule = require(stackExtension)
                }
                if (typeof stackPluginModule.preCreation === 'function') {
                    const { resultParameters, stackOutputData } = mappingParameters(docYaml, parameters)
                    stackPluginModule.preCreation({ simplify, provider, config }, configStackName, resultParameters, docYaml, stackOutputData).then(parameterResult => {
                        const { resultParameters, resultErrors } = mappingParameters(docYaml, parameterResult)
                        if (!resultErrors) {
                            simplify.consoleWithMessage(`${opName}-PreCreation`, `${stackExtension + '.js'} - (Executed)`)
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
                        simplify.consoleWithMessage(`${opName}-PreCreation`, `${stackExtension + '.js'} - (Skipped)`)
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
    const stackConfigFile = path.resolve(config.OutputFolder, 'StackConfig.json')
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
    const stackConfigFile = path.resolve(config.OutputFolder, 'StackConfig.json')
    var policyDocument = simplify.getContentFile(path.resolve(functionName ? functionName : '', policyFile || 'policy.json'), envOptions)
    var assumeRoleDocument = simplify.getContentFile(path.resolve(functionName ? functionName : '', roleFile || 'role.json'), envOptions)
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
            let outputData = { }
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
    const { regionName, functionName, envName, configFile, envFile, withFunctionLayer } = options
    const envFilePath = path.resolve(functionName ? functionName : '', envFile || '.env')
    if (fs.existsSync(envFilePath)) {
        require('dotenv').config({ path: envFilePath })
    }
    const envOptions = { FUNCTION_NAME: functionName, DEPLOYMENT_ENV: envName, DEPLOYMENT_REGION: regionName }
    var config = simplify.getInputConfig(path.resolve(functionName ? functionName : '', configFile || 'config.json'), envOptions)
    const stackConfigFile = path.resolve(config.OutputFolder, 'StackConfig.json')
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
            fs.unlinkSync(path.resolve(config.OutputFolder, `${data.FunctionName}.hash`))
            fs.unlinkSync(path.resolve(config.OutputFolder, `${data.FunctionName}.json`))
            simplify.consoleWithMessage(`${opName}-DestroyFunction`, `Done. ${data.FunctionName}`)
        })
    }).then(data => {
        return simplify.deleteDeploymentBucket({ adaptor: provider.getStorage(), bucketName: config.Bucket.Name }).then(function () {
            simplify.consoleWithMessage(`${opName}-DestroyBucket`, `Done. ${config.Bucket.Name}`)
        })
    }).catch(error => simplify.consoleWithMessage(`${opName}-DestroyFunction-ERROR`, getErrorMessage(error)))
}

const createStackOnInit = function (stackNameOrURL, envArgs) {
    const writeTemplateOutput = (templateFolderName, projectLocation) => {
        const inputDirectory = path.join(__dirname, ...templateFolderName.split('/'), typeof stackNameOrURL === 'string' ? stackNameOrURL : '')
        if (fs.existsSync(inputDirectory)) {
            utilities.getFilesInDirectory(inputDirectory).then(function (files) {
                files.forEach(function (filePath) {
                    var outputFileName = filePath.replace(inputDirectory, `${projectLocation}`).replace(/^projects\//, '').replace(/^\/+/, '').replace(/^\\+/, '')
                    fs.readFile(filePath, function (err, data) {
                        if (err) reject(err)
                        else {
                            const pathDirName = path.dirname(path.resolve(outputFileName))
                            if (!fs.existsSync(pathDirName)) {
                                fs.mkdirSync(pathDirName, { recursive: true })
                            }
                            let dataReadBuffer = fs.readFileSync(filePath).toString('utf8')
                            if (outputFileName.endsWith('dotenv')) {
                                const parserArgs = typeof stackNameOrURL === 'object' ? stackNameOrURL : envArgs || {}
                                Object.keys(parserArgs).map(k => {
                                    dataReadBuffer = dataReadBuffer.replace(`##${k}##`, parserArgs[k])
                                })
                            }
                            fs.writeFileSync(path.resolve(outputFileName.replace('dotenv', '.env')), dataReadBuffer)
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
            }).catch(error => simplify.finishWithErrors(`${opName}-DownloadTemplate-ERROR`, getErrorMessage(error)))
        } else {
            writeTemplateOutput("template/functions", argv.name || stackNameOrURL)
            writeTemplateOutput("template/stacks", argv.name || stackNameOrURL)
            simplify.finishWithMessage(`Initialized`, `${path.resolve('.')}`)
        }
    } else {
        writeTemplateOutput("template/projects", "")
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
    const stackConfigFile = path.resolve(config.OutputFolder, 'StackConfig.json')
    const stackList = fs.existsSync(stackConfigFile) ? JSON.parse(fs.readFileSync(stackConfigFile)) : {}
    let tableData = []
    if (Object.keys(stackList).length > 0) {
        console.log(`\n * ${prompt ? prompt : `Listing installed components for ${CNOTIF}${envName || process.env.DEPLOYMENT_ENV}${CDONE} environment \n`}`)
        Object.keys(stackList).map((stackName, idx) => {
            tableData.push({
                Index: idx + 1,
                Name: stackName,
                Type: stackList[stackName].StackId ? "CF-Stack" : "Function",
                Region: stackList[stackName].Region,
                ResourceId: (stackList[stackName].StackId || stackList[stackName].FunctionArn).truncate(30),
                Status: "INSTALLED",
                LastUpdate: utilities.formatTimeSinceAgo(stackList[stackName].LastUpdate)
            })
        })
        utilities.printTableWithJSON(tableData)
    } else {
        console.log(`\n * Listing installed components for ${CNOTIF}${envName || process.env.DEPLOYMENT_ENV}${CDONE} environment: (empty) \n`)
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
    const stackConfigFile = path.resolve(config.OutputFolder, 'StackConfig.json')
    const stackList = fs.existsSync(stackConfigFile) ? JSON.parse(fs.readFileSync(stackConfigFile)) : {}
    let stackStatus = "AVAILABLE"
    let stackUpdate = "         "
    let stackType = ""
    let indexOfTemplate = 0
    let tableStackData = []
    console.log(`\n * ${promptDescription}\n`)
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

var argv = require('yargs').usage('simplify-cli init | deploy | destroy | show [options]')
    .string('help').describe('help', 'Display Help for a specific command')
    .string('name').describe('name', 'Specify a name for the created project')
    .string('template').describe('template', 'Init nodejs or python template')
    .string('data').describe('data', 'Additional parameters in JSON file').default('data', 'data.json')
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
    .string('stack').describe('stack', 'stack name to deploy')
    .string('function').describe('function', 'function name to deploy')
    .string('composer').describe('composer', 'multistacks composer to deploy')
    .demandOption(['c', 'p', 's']).demandCommand(1).argv;

var cmdOPS = (argv._[0] || 'deploy').toUpperCase()
var optCMD = (argv._.length > 1 ? argv._[1]: undefined)
var cmdArg = argv['stack'] || argv['function'] || optCMD
var cmdType = cmdArg ? fs.existsSync(path.resolve(cmdArg, "template.yaml")) ? "CF-Stack" : "Function" : undefined

if (cmdOPS === "DEPLOY") {
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

} else if (cmdOPS === "DESTROY") {
    if (argv['stack'] !== undefined) {
        destroyStack({
            regionName: argv.region,
            configFile: argv.config,
            envName: argv.env,
            envFile: argv['env-file'],
            configStackFolder: argv.location,
            configStackName: argv['stack']
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
        printListingDialog({
            regionName: argv.region,
            configFile: argv.config,
            envName: argv.env,
            envFile: argv['env-file']
        }, `Select a ${CPROMPT}stack${CRESET} or ${CPROMPT}function${CRESET} to destroy with command: simplify-cli destroy [--stack or --function] name`)
    }
} else if (cmdOPS === "SHOW") {
    printListingDialog({
            regionName: argv.region,
            configFile: argv.config,
            envName: argv.env,
            envFile: argv['env-file']
        }, `Deployed ${CPROMPT}stacks${CRESET} and ${CPROMPT}functions${CRESET} managed by Simplify CLI:`)
} else if (cmdOPS === "INIT") {
    const templateName = argv.template || optCMD
    if (typeof templateName === "undefined") {
        if (typeof argv.help !== "undefined") {
            showTemplates("template/functions", `\nCreate a deployment template: simplify-cli init [--template=]NodeJS | Python\n`)
            showTemplates("template/stacks", `\nCreate associated CF stack: simplify-cli init [--template=]CloudFront | CognitoUser...\n`)
            console.log(`\n *`, `Or install from URL: simplify-cli init [--template=]https://github.com/awslabs/...template.yml \n`)
        } else {
            createStackOnInit({
                PROJECT_NAME: readlineSync.question(` - ${CPROMPT}What is your Project name?${CRESET} (${process.env.PROJECT_NAME || 'starwars'}) `) || `${process.env.PROJECT_NAME || 'starwars'}`,
                DEPLOYMENT_BUCKET: readlineSync.question(` - ${CPROMPT}What is your Bucket name?${CRESET} (${process.env.DEPLOYMENT_BUCKET || 'starwars-0920'}) `) || `${process.env.DEPLOYMENT_BUCKET || 'starwars-0920'}`,
                DEPLOYMENT_ACCOUNT: readlineSync.question(` - ${CPROMPT}What is your Account Id?${CRESET} (${process.env.DEPLOYMENT_ACCOUNT || '1234567890'}) `) || `${process.env.DEPLOYMENT_ACCOUNT || '1234567890'}`,
                DEPLOYMENT_PROFILE: readlineSync.question(` - ${CPROMPT}What is your Account profile?${CRESET} (${process.env.DEPLOYMENT_PROFILE || 'simplify-eu'}) `) || `${process.env.DEPLOYMENT_PROFILE || 'simplify-eu'}`,
                DEPLOYMENT_REGION: readlineSync.question(` - ${CPROMPT}What is your Default region?${CRESET} (${process.env.DEPLOYMENT_REGION || 'eu-central-1'}) `) || `${process.env.DEPLOYMENT_REGION || 'eu-central-1'}`,
                DEPLOYMENT_ENV: readlineSync.question(` - ${CPROMPT}What is your Environment name?${CRESET} (${process.env.DEPLOYMENT_ENV || 'demo'}) `) || `${process.env.DEPLOYMENT_ENV || 'demo'}`
            })
            console.log(`\n *`, `Type '--help' with INIT to find more: simplify-cli init --help \n`)
        }
    } else {
        createStackOnInit(templateName, process.env)
    }
} else if (cmdOPS === "LIST") {
    printListingDialog({
        regionName: argv.region,
        configFile: argv.config,
        envName: argv.env,
        envFile: argv['env-file']
    })
}

module.exports = {
    deployFunction,
    destroyFunction,
    deployStack,
    destroyStack
}
