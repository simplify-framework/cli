require('cross-fetch/polyfill');
var AmazonCognitoIdentity = require('amazon-cognito-identity-js');
var CognitoUserPool = AmazonCognitoIdentity.CognitoUserPool;
const { v4 } = require('uuid');
const ApplicationStorage = require('./storage')


var poolData = {
    UserPoolId: 'us-east-1_UAf0SxZ5c',
    ClientId: '72nrnku0iajiqlahhvkvhqgln2',
    Storage: ApplicationStorage
};
var userPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);

const registerUser = function (name, email, password) {
    var attributeList = [];
    attributeList.push(new AmazonCognitoIdentity.CognitoUserAttribute({
        Name: 'email',
        Value: email,
    }));
    attributeList.push(new AmazonCognitoIdentity.CognitoUserAttribute({
        Name: 'name',
        Value: name,
    }));
    return new Promise(function (resolve, reject) {
        userPool.signUp(v4(), password, attributeList, null, function (err, result) {
            if (err) {
                reject(err.message || JSON.stringify(err));
            } else {
                var cognitoUser = result.user;
                resolve(cognitoUser);
            }
        });
    })
}

const confirmRegistration = function (username, code) {
    var userData = {
        Username: username,
        Pool: userPool,
        Storage: ApplicationStorage
    };
    var cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);
    return new Promise(function (resolve, reject) {
        cognitoUser.confirmRegistration(code, true, function (err, result) {
            if (err) {
                reject(err.message || JSON.stringify(err));
            } else {
                resolve(result);
            }
        });
    })
}

const getCurrentSession = function () {
    var cognitoUser = userPool.getCurrentUser();
    if (cognitoUser != null) {
        return new Promise(function (resolve, reject) {
            cognitoUser.getSession(function (err, session) {
                if (err) {
                    reject(err.message || JSON.stringify(err));
                } else {
                    if (session.isValid()) {
                        resolve(session)
                    } else {
                        cognitoUser.refreshSession(session.getRefreshToken(), (err, session) => {
                            if (err) {
                                reject(err.message || JSON.stringify(err));
                            } else {
                                resolve(session)
                            }
                        })
                    }
                }
            });
        })
    } else {
        return Promise.reject(`Session is not found`)
    }
}

const authenticate = function (email, password) {
    var authenticationData = {
        Username: email,
        Password: password,
    };
    var authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails(
        authenticationData
    );
    var userData = {
        Username: email,
        Pool: userPool,
        Storage: ApplicationStorage
    };
    var cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);
    return new Promise(function (resolve, reject) {
        cognitoUser.authenticateUser(authenticationDetails, {
            onSuccess: function (result) {
                resolve(result)
            },
            onFailure: function (err) {
                reject(err.message || JSON.stringify(err));
            },
        });
    })
}

const userSignOut = function(username) {
    var cognitoUser = new AmazonCognitoIdentity.CognitoUser({
        Username: username,
        Pool: userPool,
        Storage: ApplicationStorage
    });
    cognitoUser.signOut();
}

module.exports = {
    authenticate,
    registerUser,
    confirmRegistration,
    getCurrentSession,
    userSignOut
}