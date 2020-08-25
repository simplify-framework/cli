# Simplify - Serverless

![NPM Downloads](https://img.shields.io/npm/dw/simplify-cli)
![Package Version](https://img.shields.io/github/package-json/v/simplify-framework/serverless?color=green)

A minimalist and optimistic serverless framwork for AWS Lambda

`npm install -g simplify-cli`

```bash
╓───────────────────────────────────────────────────────────────╖
║              Simplify Framework - Version 0.1.40              ║
╙───────────────────────────────────────────────────────────────╜
simplify-cli init | deploy | destroy [options]

Options:
  --help          Show help                                            [boolean]
  --version       Show version number                                  [boolean]
  -c, --config    function configuration                     [string] [required]
  -p, --policy    function policy to attach                  [string] [required]
  -r, --role      function policy to attach                             [string]
  -s, --source    function source to deploy                  [string] [required]
  -e, --env       environment variable file                             [string]
  -u, --update    force update function code                           [boolean]
  -l, --layer     deploy source folder as layer                        [boolean]
  -t, --template  Init nodejs or python template                        [string]
 ```
  
### Init your environment

    simplify-cli init

    Will generate .env, config.json, role.json and policy.json:
    
    - Prepare your environment (.env file) with a `Function Name`
    - Change function configuration if needed, eg: `MemorySize: 128`
    - Change resource access policy to your database or others.

### Deploy your function

    1. simplify-cli deploy -s "src"                 # resilience deploying your function code 
    2. simplify-cli deploy -u                       # force re-deploying your function code 
    3. simplify-cli deploy -l -s "layer"            # adding layer to your function configuration

### Destroy your function

    1. simplify-cli destroy                         # destroy your function only, keep layers
    2. simplify-cli destroy -l                      # destroy your function with all layers

