# Simplify Framework - Serverless CLI

![NPM Downloads](https://img.shields.io/npm/dw/simplify-cli)
![Package Version](https://img.shields.io/github/package-json/v/simplify-framework/serverless?color=green)

*A minimalist and optimistic serverless framwork for managing AWS Lambda functions.*

`npm install -g simplify-cli`

```bash
╓───────────────────────────────────────────────────────────────╖
║              Simplify Framework - Version 0.1.42              ║
╙───────────────────────────────────────────────────────────────╜
simplify-cli init | deploy | destroy [options]

Options:
  --help        Show help                                              [boolean]
  --version     Show version number                                    [boolean]
  --update      force update function code            [boolean] [default: false]
  --publish     force publish with a version          [boolean] [default: false]
  --layer       deploy source folder as layer         [boolean] [default: false]
  --location    stack folder to deploy              [string] [default: "stacks"]
  --stack-name  stack name to deploy                                    [string]
  --template    Init nodejs or python template      [string] [default: "nodejs"]
  -c, --config  function configuration                       [string] [required]
  -p, --policy  function policy to attach                    [string] [required]
  -r, --role    function policy to attach                               [string]
  -s, --source  function source to deploy                    [string] [required]
  -e, --env     environment variable file                               [string]
 ```
  
### Init your environment

    simplify-cli init

    Will generate .env, config.json, role.json and policy.json:
    
    - Prepare your environment (.env file) with a `Function Name`
    - Change function configuration if needed, eg: `MemorySize: 128`
    - Change resource access policy to your database or others.

### Deploy your function

    1. simplify-cli deploy --source src             # resilience deploying your function code 
    2. simplify-cli deploy --update --publish       # publish the latest code to a lambda version
    3. simplify-cli deploy --layer --source layer   # make the layer/nodejs folder into lambda layer

### Destroy your function

    1. simplify-cli destroy                         # destroy your function only, keep layers
    2. simplify-cli destroy --layer                 # destroy your function with all layers

### Deploy a CloudFormation stack

    1. simplify-cli deploy --stack-name HttpRestapi     # create a stack from "${location}/${stack-name}.yaml"
    3. simplify-cli deploy --stack-name HttpRestapi --location templates

### Destroy a CloudFormation stack

    1. simplify-cli destroy --stack-name HttpRestapi    # delete a selected stack name
    2. simplify-cli destroy --stack-name *              # delete all deployed stacks...

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
    preCreation: function(adaptor, stackName, stackParameters) {
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