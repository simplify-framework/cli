# Simplify Framework - Easy Deployment

![NPM Downloads](https://img.shields.io/npm/dw/simplify-cli)
![Package Version](https://img.shields.io/github/package-json/v/simplify-framework/cli?color=green)

*A minimalist and optimistic serverless framwork for managing AWS Lambda functions.*

`npm install -g simplify-cli`

```bash
$ simplify-cli init --help
╓───────────────────────────────────────────────────────────────╖
║                 Simplify CLI - Version 0.1.21                 ║
╙───────────────────────────────────────────────────────────────╜

Create a deployment template: simplify-cli init [--template=]NodeJS | Python

 1. Detector - A lambda function based on Python 3.7 runtime with default Role and Policy configuration.
 2. Lambda - A lambda function based on NodeJS 12.x runtime with default Role and Policy configuration.

Create associated CF stack: simplify-cli init [--template=]CloudFront | CognitoUser...

 1. CloudFront - A template to create a CDN using CloudFront for S3 Website and HTTP APIs origin.
 2. CognitoUser - A template to create a Cognito UserPool, Cognito Indentity and Pinpoint analytics.
 3. EventScheduler - A CloudWatch scheduler event for triggering a lambda function with schedule expresion.
 4. HttpRestapi - A template to create a REST API Gateway that work with Lambda functions.
 5. LambdaEdge - A template to create a CDN using CloudFront that works with LambdaEdge function.
 6. Randomness - A Lambda randomness source to use in common case for other Lambdas
 7. WebsiteS3 - An HTML website hosting by Amazon S3 Bucket that support publishing extension script.

 * Or install from URL: simplify-cli init [--template=]https://github.com/awslabs/...template.yml
 ```
  
### Init your environment

    simplify-cli init **Lambda** --name LambdaTest

    Will generate .env, config.json, role.json and policy.json:
    
    - Prepare your environment (.env file) with a `Function Name`
    - Change function configuration if needed, eg: `MemorySize: 128`
    - Change resource access policy to your database or others.

### Deploy your function

    1. simplify-cli deploy --function LambdaTest --source src             # resilience deploying your function code 
    2. simplify-cli deploy --function LambdaTest --update --publish       # publish the latest code to a lambda version
    3. simplify-cli deploy --function LambdaTest --layer --source layer   # make the layer/nodejs folder into lambda layer

### Destroy your function

    1. simplify-cli destroy --function LambdaTest                         # destroy your function only, keep layers
    2. simplify-cli destroy --function LambdaTest --layer                 # destroy your function with all layers

### Deploy a CloudFormation stack

    1. simplify-cli deploy --stack HttpRestapi     # create a stack from "${location}/${stack-name}.yaml"
    3. simplify-cli deploy --stack HttpRestapi --location templates

### Destroy a CloudFormation stack

    1. simplify-cli destroy --stack HttpRestapi    # delete a selected stack name

### Deployment Extension for CloudFromation

- Each stack has an ability to add an extension code for stack creation/destruction.
- The extension Javascript file will be located at `${location}/${stack-name}.js`

```Javascript
'use strict';
const path = require('path')
const fs = require('fs')
const opName = `Extension`
module.exports = {
    /** Called before stack creation, return StackParameters = { Environmemt, ...} */
    preCreation: function(adaptor, stackName, mappedParameters, stackYAML, stackInputs) {
        return Promise.resolve(stackParameters)
    },
    /** Called after the `${location}/${stack-name}.yaml` was deployed */
    postCreation: function(adaptor, stackName, stackData) {
        const { simplify, provider, config } = adaptor
        return Promise.resolve(stackData)
    },
    /** Called before stack destruction, return { stackName } */
    preCleanup: function(adaptor, stackName, stackList) {
        const { simplify, provider, config } = adaptor
        return Promise.resolve(stackName)
    },
    /** Called after the `${location}/${stack-name}.yaml` was destroyed  */
    postCleanup: function(adaptor, stackName, stackList, stackData) {
        const { simplify, provider, config } = adaptor
        return Promise.resolve(stackData)
    }
}
```
