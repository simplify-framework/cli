var AWS = require('aws-sdk');
const { exec } = require('child_process');
const { v4 } = require('uuid');
const ApplicationStorage = require('./storage')
const COGNITO_PINPOINT_APPID = '4c6b346287ab4e86a284a88e46352738'
const COGNITO_IDENTITY_POOL_ID = 'us-east-1:9e72cdc0-12d9-471c-ba71-a6a20e6e15ab'
const COGNITO_PINPOINT_REGION = 'us-east-1'

function getCognitoCredentials() {
    const cognitoIdentity = new AWS.CognitoIdentity({ region: COGNITO_PINPOINT_REGION });
    AWS.config.update({ region: COGNITO_PINPOINT_REGION });
    return new Promise(function(resolve, reject) {
        let identityId = ApplicationStorage.getItem(`AWS.Pinpoint.IdentityId`)
        if (!identityId) {
            cognitoIdentity.getId({
                IdentityPoolId: COGNITO_IDENTITY_POOL_ID
            }, function(err, data) {
                if (err) {
                    reject(err)
                } else {
                    ApplicationStorage.setItem(`AWS.Pinpoint.IdentityId`, data.IdentityId)
                    resolve(new AWS.CognitoIdentityCredentials({
                        IdentityPoolId: COGNITO_IDENTITY_POOL_ID,
                        IdentityId: data.IdentityId
                    }))
                }
            })
        } else {
            resolve(new AWS.CognitoIdentityCredentials({
                IdentityPoolId: COGNITO_IDENTITY_POOL_ID,
                IdentityId: identityId
            }))
            console.log("getCognitoCredentials=", Date.now() - startTime)
        }
    })
}

const getOSInfos = function() {
    return new Promise(function(resolve, reject) {
        exec(`aws --version`, (err, stdout, stderr) => {
            if (err || stderr) {
                reject(err || stderr)
            } else {
                const vParts = stdout.trim().split(' ')
                resolve({
                    BotoCore: vParts.length >= 3 ? vParts[3].split('/')[0] : 'unknown',
                    Platform: vParts.length >= 2 ? vParts[2].split('/')[0] : 'unknown',
                    PlatformVersion: vParts.length >= 2 ? vParts[2].split('/')[1] : 'unknown',
                    Python: vParts.length >= 1 ? vParts[1].split('/')[0] : 'unknown',
                    PythonVersion: vParts.length >= 1 ? vParts[1].split('/')[1] : 'unknown'
                })
            }
        })
    })
}

const updateEndpoint = function (userId) {
    return new Promise(function(resolve, reject) {
        let endpointId = ApplicationStorage.getItem(`AWS.Pinpoint.EndpointId`)
        function updateEndpointWithAttributes(endpointAttributes) {
            const lastRegion = AWS.config.region
            getCognitoCredentials().then(function(creds) {
                const lastCreds = AWS.config.credentials
                AWS.config.update({ credentials: creds })
                var pinpoint = new AWS.Pinpoint({
                    apiVersion: '2016-12-01',
                    region: COGNITO_PINPOINT_REGION
                })                
                pinpoint.updateEndpoint({
                    ApplicationId: COGNITO_PINPOINT_APPID,
                    EndpointId: endpointId,
                    EndpointRequest: {
                        ...endpointAttributes
                    }
                }, function (err, data) {
                    AWS.config.update({ credentials: lastCreds, region: lastRegion })
                    err ? reject(err) : resolve(data)
                })
            }).catch(err => {
                AWS.config.update({ region: lastRegion })
                reject(err)
            })
        }
        getOSInfos().then(osInfos => {
            let endpointAttributes = {
                Address: endpointId || v4(),
                ChannelType: 'EMAIL',
                OptOut: 'ALL',
                Demographic: {
                    AppVersion: require('./package').version,
                    Make: osInfos.BotoCore,
                    Platform: osInfos.Platform,
                    PlatformVersion: osInfos.PlatformVersion,
                    Model: osInfos.Python,
                    ModelVersion: osInfos.PythonVersion,
                },
                EndpointStatus: 'ACTIVE',
                EffectiveDate: new Date().toISOString(),
                RequestId: v4(),
                User: {
                    UserAttributes: [],
                    UserId: userId || endpointId
                }
            }
            if (!endpointId) {
                exec('grep docker /proc/1/cgroup -qa', (err, stdout, stderr) => {
                    if (err || stderr) {
                        ApplicationStorage.setItem(`AWS.Pinpoint.EndpointId`, endpointId = v4())
                        updateEndpointWithAttributes(endpointAttributes)
                    } else {
                        exec('cat /proc/self/cgroup | head -n 1 | tr ‘/’ ‘\n’ | tail -1 | cut -c1-12', (err, stdout, stderr) => {
                            ApplicationStorage.setItem(`AWS.Pinpoint.EndpointId`, endpointId = (stdout || v4()))
                            updateEndpointWithAttributes(endpointAttributes)
                        })
                    }
                })
            } else {
                updateEndpointWithAttributes(endpointAttributes)
            }
        }).catch(err => reject(err))
    })
}

const updateEvent = function (eventType, eventAttrs, userId, timeToSendBatchOut) {
    return new Promise(function(resolve, reject) {
        let endpointId = ApplicationStorage.getItem(`AWS.Pinpoint.EndpointId`)
        getOSInfos().then(osInfos => {
            let endpointAttributes = {
                Address: endpointId || v4(),
                ChannelType: 'EMAIL',
                OptOut: 'ALL',
                Demographic: {
                    AppVersion: require('./package').version,
                    Make: osInfos.BotoCore,
                    Platform: osInfos.Platform,
                    PlatformVersion: osInfos.PlatformVersion,
                    Model: osInfos.Python,
                    ModelVersion: osInfos.PythonVersion,
                },
                EndpointStatus: 'ACTIVE',
                EffectiveDate: new Date().toISOString(),
                RequestId: v4(),
                User: {
                    UserAttributes: [],
                    UserId: userId || endpointId
                }
            }
            const lastRegion = AWS.config.region
            getCognitoCredentials().then(function(creds) {
                const lastCreds = AWS.config.credentials
                AWS.config.update({ credentials: creds })
                let newEvent = {
                    Endpoint: {
                        ...endpointAttributes
                    },
                    Events: {}
                }
                newEvent.Events[`${eventType}`] = {
                    EventType: eventType,
                    Attributes : eventAttrs || {},
                    Timestamp: new Date().toISOString(),
                    Session: {
                        Id: endpointId,
                        StartTimestamp: new Date().toISOString()
                    }
                }
                let params = {
                    ApplicationId: COGNITO_PINPOINT_APPID,
                    EventsRequest: {
                        BatchItem: []
                    }
                }
                params.EventsRequest.BatchItem = JSON.parse(ApplicationStorage.getItem(`AWS.Pinpoint.BatchEvents`) || "[]")
                params.EventsRequest.BatchItem.push(newEvent)
                if (params.EventsRequest.BatchItem.length >= 10 || timeToSendBatchOut) {
                    var pinpoint = new AWS.Pinpoint({
                        apiVersion: '2016-12-01',
                        region: COGNITO_PINPOINT_REGION
                    })
                    pinpoint.putEvents(params, function (err, data) {
                        ApplicationStorage.setItem(`AWS.Pinpoint.BatchEvents`, JSON.stringify([]))
                        AWS.config.update({ credentials: lastCreds, region: lastRegion })
                        err ? reject(err) : resolve(data)
                    })
                } else {
                    ApplicationStorage.setItem(`AWS.Pinpoint.BatchEvents`, JSON.stringify(params.EventsRequest.BatchItem))
                }
            }).catch(err => {
                AWS.config.update({ region: lastRegion })
                reject(err)
            })
        }).catch(err => reject(err))
    })
}

module.exports = {
    updateEndpoint,
    updateEvent
}