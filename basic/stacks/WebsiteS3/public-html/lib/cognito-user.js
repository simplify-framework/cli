function initCognito(options, callback, errorHandler) {
    const { UserPoolId, WebClientId } = options
    var userPool = new AmazonCognitoIdentity.CognitoUserPool({
        UserPoolId: UserPoolId,
        ClientId: WebClientId
    })

    function doCognitoSignIn(username, password) {
        var authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails({
            Username: username,
            Password: password,
        });
        var cognitoUser = new AmazonCognitoIdentity.CognitoUser({
            Username: username,
            Pool: userPool,
        });
        return new Promise((resolve, reject) => {
            cognitoUser.authenticateUser(authenticationDetails, {
                onSuccess: function (result) {
                    resolve(result)
                },
                onFailure: function (result) {
                    reject(result)
                }
            });
        })
    }

    return {
        refresh: function(onRequest) {
            const cognitoUser = userPool.getCurrentUser()
            if (cognitoUser === null) {
                onRequest && onRequest((username, password) => {
                    doCognitoSignIn(username, password).then(result => {
                        callback && callback(result)
                    }).catch(error => errorHandler && errorHandler(error))
                })
                !onRequest && console.log("onRequest:", "Not handled!")
            } else {
                cognitoUser.getSession((err, session) => {
                    !err && session && callback && callback(session)
                    err && (errorHandler && errorHandler(err))
                })
            }
        },
        signOut: function(callback) {
            const cognitoUser = userPool.getCurrentUser()
            if (cognitoUser !== null) {
                cognitoUser.signOut()
            }
            callback && callback()
        }
    }
}
